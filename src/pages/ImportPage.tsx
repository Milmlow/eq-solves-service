import { useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FileText,
  Info,
  Plus,
  Upload,
} from 'lucide-react'
import { navigate } from '../lib/router'
import { parseTemplate, type ParsedTemplate } from '../lib/templateParser'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Pill } from '../components/ui/Pill'
import { cn } from '../lib/cn'

type Stage = 'idle' | 'parsing' | 'preview' | 'creating' | 'done' | 'error'

export function ImportPage() {
  const [stage, setStage] = useState<Stage>('idle')
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [clientCode, setClientCode] = useState('DCCA')
  const [siteCode, setSiteCode] = useState('')
  const [jobName, setJobName] = useState('')
  const [jobPin, setJobPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createdJobIds, setCreatedJobIds] = useState<string[]>([])
  const [createdJobSlugs, setCreatedJobSlugs] = useState<Array<string | null>>([])

  const stepIndex = stage === 'idle' ? 0 : stage === 'preview' ? 1 : stage === 'done' ? 2 : stage === 'creating' ? 2 : 0

  const onFile = async (f: File) => {
    console.info('[import] file selected', { name: f.name, size: f.size, type: f.type })
    setFile(f)
    setStage('parsing')
    setError(null)
    try {
      console.info('[import] parseTemplate start')
      const p = await parseTemplate(f)
      console.info('[import] parseTemplate done', {
        assets: p.assets.length,
        classifications: p.classifications,
        detectedSite: p.detectedSite,
        detectedClassification: p.detectedClassification,
        warnings: p.warnings,
        fieldsByClassification: Object.fromEntries(
          Object.entries(p.fieldsByClassification).map(([k, v]) => [k, v.length]),
        ),
      })
      setParsed(p)
      setSiteCode(p.detectedSite ?? '')
      if (p.detectedSite && p.detectedClassification) {
        setJobName(`${p.detectedSite} ${p.detectedClassification} — Asset Capture`)
      }
      setStage('preview')
    } catch (err: any) {
      console.error('[import] parse failed', err)
      setError(err?.message ?? String(err))
      setStage('error')
    }
  }

  const create = async () => {
    if (!parsed || !siteCode.trim()) {
      console.warn('[import] create aborted — no parsed template or site code', {
        hasParsed: !!parsed,
        siteCode,
      })
      return
    }
    console.info('[import] create start', {
      classifications: parsed.classifications,
      assets: parsed.assets.length,
      siteCode,
      clientCode,
    })
    setStage('creating')
    setError(null)
    try {
      const createdIds: string[] = []
      const createdSlugs: Array<string | null> = []
      const makeSlug = (site: string, cls: string) =>
        `${site}-${cls}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')

      if (parsed.classifications.length === 0) {
        throw new Error(
          'No classifications were detected in the template. The "Classification" column in Assets (col 12) appears to be blank for every row.',
        )
      }

      for (const cls of parsed.classifications) {
        console.info(`[import] → classification ${cls}: upserting`)
        // Ensure the classifications row exists first — classification_fields
        // FKs on classifications(code), so a brand-new code from a template
        // would otherwise fail the field upsert with a FK violation.
        const { error: cErr } = await supabase
          .from('classifications')
          .upsert({ code: cls } as never, { onConflict: 'code', ignoreDuplicates: true })
        if (cErr) {
          console.error('[import] classifications upsert error', cErr)
          throw new Error(`Classification upsert failed for ${cls}: ${cErr.message}`)
        }
        console.info(`[import] ✓ classification ${cls} upserted`)

        const fields = parsed.fieldsByClassification[cls] ?? []
        console.info(`[import] → ${cls}: ${fields.length} fields to upsert`)
        if (fields.length > 0) {
          const fieldRows = fields.map((f) => ({
            classification_code: cls,
            spec_id: f.spec_id,
            display_name: f.display_name,
            definition: f.definition,
            sample_values: f.sample_values,
            data_type: f.data_type,
            display_order: f.display_order,
            is_field_captured: f.is_field_captured,
            field_group: f.field_group,
            options: f.options,
          }))
          const { error: fErr } = await supabase
            .from('classification_fields')
            .upsert(fieldRows as never, { onConflict: 'classification_code,spec_id' })
          if (fErr) {
            console.error('[import] classification_fields upsert error', fErr)
            throw new Error(`Field upsert failed for ${cls}: ${fErr.message}`)
          }
          console.info(`[import] ✓ ${fields.length} fields upserted for ${cls}`)
        }

        const baseSlug = makeSlug(siteCode.trim(), cls)
        let slug: string | null = baseSlug
        for (let i = 2; i < 10; i++) {
          const { data: exists } = await supabase
            .from('jobs')
            .select('id')
            .eq('slug', slug!)
            .maybeSingle()
          if (!exists) break
          slug = `${baseSlug}-${i}`
        }

        const jobRow = {
          slug,
          site_code: siteCode.trim().toUpperCase(),
          client_code: clientCode.trim().toUpperCase(),
          classification_code: cls,
          name: parsed.classifications.length === 1 ? jobName : `${siteCode} ${cls} — Asset Capture`,
          template_filename: parsed.templateFilename,
          active: true,
        }
        console.info(`[import] → inserting job`, jobRow)
        const jobResp = await supabase.from('jobs').insert(jobRow as never).select('id, slug').single()
        if (jobResp.error) {
          console.error('[import] job insert error', jobResp.error)
          throw new Error(`Job creation failed: ${jobResp.error.message}`)
        }
        const newJob = jobResp.data as { id: string; slug: string | null }
        console.info(`[import] ✓ job created`, newJob)
        createdIds.push(newJob.id)
        createdSlugs.push(newJob.slug)

        if (jobPin.trim().length === 4 && /^\d{4}$/.test(jobPin.trim())) {
          const { error: pinErr } = await supabase.rpc('set_job_pin' as never, {
            job: newJob.id,
            new_pin: jobPin.trim(),
          } as never)
          if (pinErr) console.warn('Could not set PIN:', pinErr.message)
        }

        const clsAssets = parsed.assets.filter((a) => a.classification_code === cls)
        console.info(`[import] → ${cls}: ${clsAssets.length} assets to insert`)
        if (clsAssets.length > 0) {
          const assetRows = clsAssets.map((a) => ({
            job_id: newJob.id,
            row_number: a.row_number,
            asset_id: a.asset_id,
            description: a.description,
            classification_code: cls,
            location_id: a.location_id,
            location_description: a.location_description,
            manufacturer: a.manufacturer,
            model: a.model,
            serial: a.serial,
            source_row: a.source_row,
          }))
          const CHUNK = 100
          for (let i = 0; i < assetRows.length; i += CHUNK) {
            const { error: aErr } = await supabase
              .from('assets')
              .insert(assetRows.slice(i, i + CHUNK) as never)
            if (aErr) {
              console.error('[import] asset insert error', aErr)
              throw new Error(`Asset insert failed: ${aErr.message}`)
            }
          }
          console.info(`[import] ✓ ${clsAssets.length} assets inserted for ${cls}`)
        }
      }

      console.info('[import] ALL DONE', { createdIds, createdSlugs })
      setCreatedJobIds(createdIds)
      setCreatedJobSlugs(createdSlugs)
      setStage('done')
    } catch (err: any) {
      console.error('[import] create failed', err)
      setError(err?.message ?? String(err))
      setStage('error')
    }
  }

  return (
    <div className="max-w-[960px] mx-auto">
      {/* Header */}
      <div className="mb-5">
        <div className="text-[20px] font-bold tracking-[-0.01em] leading-tight">Import template</div>
        <div className="text-[12px] text-muted mt-1">
          Turn a spreadsheet into a capture job. We'll detect fields and classifications automatically.
        </div>
      </div>

      {/* Stepper */}
      <Stepper
        labels={['Choose file', 'Review & map', 'Create']}
        current={stepIndex}
        className="mb-4"
      />

      {/* Step bodies */}
      {stage === 'idle' && <UploaderCard onFile={onFile} />}

      {stage === 'parsing' && (
        <Card className="p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-ice text-sky-deep flex items-center justify-center">
            <Upload size={22} strokeWidth={2} />
          </div>
          <div className="text-[15px] font-bold text-ink mb-1">Parsing template…</div>
          <div className="text-[12px] text-muted">
            Reading sheets, detecting green cells, extracting LOVs
          </div>
        </Card>
      )}

      {stage === 'preview' && parsed && (
        <Preview
          parsed={parsed}
          file={file!}
          siteCode={siteCode}
          setSiteCode={setSiteCode}
          clientCode={clientCode}
          setClientCode={setClientCode}
          jobName={jobName}
          setJobName={setJobName}
          jobPin={jobPin}
          setJobPin={setJobPin}
          onConfirm={create}
          onReset={() => {
            setStage('idle')
            setParsed(null)
            setFile(null)
          }}
        />
      )}

      {stage === 'creating' && (
        <Card className="p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-ice text-sky-deep flex items-center justify-center">
            <Upload size={22} strokeWidth={2} className="animate-pulse" />
          </div>
          <div className="text-[15px] font-bold text-ink mb-1">
            Creating job{parsed && parsed.classifications.length > 1 ? 's' : ''}…
          </div>
          <div className="text-[12px] text-muted">Inserting fields and assets</div>
        </Card>
      )}

      {stage === 'done' && (
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-ok-bg text-ok flex items-center justify-center">
              <Check size={26} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[16px] font-bold text-ink">
                {createdJobIds.length} job{createdJobIds.length === 1 ? '' : 's'} created
              </div>
              <div className="text-[12px] text-muted">
                Ready for field capture. Jump straight in or share the link.
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {createdJobIds.map((id, idx) => {
              const slug = createdJobSlugs[idx]
              const displayRef = slug ?? id
              return (
                <div key={id} className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] font-mono bg-gray-50 px-2.5 py-2 rounded border border-border truncate">
                    /#/j/{displayRef}
                  </code>
                  <Button size="md" variant="primary" onClick={() => navigate(`/j/${displayRef}`)}>
                    Open
                  </Button>
                </div>
              )
            })}
          </div>
          <Button
            size="md"
            variant="ghost"
            fullWidth
            className="mt-4"
            onClick={() => {
              setStage('idle')
              setParsed(null)
              setFile(null)
              setCreatedJobIds([])
            }}
          >
            Import another
          </Button>
        </Card>
      )}

      {stage === 'error' && (
        <Card className="border-bad/40 bg-bad-bg">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white text-bad flex items-center justify-center border border-bad/30">
              <AlertTriangle size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[15px] font-bold text-ink">Import failed</div>
              <div className="text-[12px] text-muted">See details below</div>
            </div>
          </div>
          <pre className="text-[11px] font-mono bg-white p-3 rounded-md border border-border overflow-x-auto whitespace-pre-wrap">
            {error}
          </pre>
          <Button
            size="md"
            variant="ghost"
            fullWidth
            className="mt-3"
            onClick={() => setStage('idle')}
          >
            Try again
          </Button>
        </Card>
      )}
    </div>
  )
}

// ─── Stepper ────────────────────────────────────────────────────────

function Stepper({
  labels,
  current,
  className,
}: {
  labels: string[]
  current: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {labels.map((label, i) => {
        const done = current > i
        const active = current === i
        return (
          <div key={i} className="flex items-center gap-1">
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-bold',
                done
                  ? 'bg-ok-bg border-ok text-ok'
                  : active
                    ? 'bg-ice border-sky-deep text-sky-deep'
                    : 'bg-white border-border text-muted',
              )}
            >
              <div
                className={cn(
                  'w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[10px] font-bold',
                  done ? 'bg-ok' : active ? 'bg-sky-deep' : 'bg-gray-300',
                )}
              >
                {done ? <Check size={11} strokeWidth={3} /> : i + 1}
              </div>
              {label}
            </div>
            {i < labels.length - 1 && <div className="w-5 h-px bg-border" />}
          </div>
        )
      })}
    </div>
  )
}

// ─── Uploader ───────────────────────────────────────────────────────

function UploaderCard({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const openPicker = () => inputRef.current?.click()

  return (
    <Card padding={0}>
      <div
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPicker()
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Choose a spreadsheet to import"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
        className={cn(
          'block m-5 p-10 text-center rounded-xl cursor-pointer border-2 border-dashed transition',
          'focus:outline-none focus-visible:shadow-focus',
          dragging ? 'border-sky bg-ice' : 'border-gray-300 bg-gray-50 hover:border-sky-deep/60',
        )}
      >
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-ice text-sky-deep flex items-center justify-center">
          <Upload size={22} strokeWidth={2} />
        </div>
        <div className="text-[15px] font-bold text-ink mb-1">Drop a spreadsheet here</div>
        <div className="text-[12px] text-muted mb-4">
          .xlsx or .xlsm · up to 5,000 rows. We'll extract the field list automatically.
        </div>
        <div className="inline-block">
          <Button
            size="md"
            variant="primary"
            icon={FileText}
            onClick={(e) => {
              // Stop the outer div's onClick from double-firing the picker.
              e.stopPropagation()
              openPicker()
            }}
          >
            Choose file
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            // Reset so picking the same file twice still fires onChange.
            e.target.value = ''
          }}
        />
      </div>
      <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-muted flex items-center gap-2">
        <Info size={12} strokeWidth={2} />
        <span>
          Equinix-format .xlsm/.xlsx templates. Green cells become field-capture slots.
        </span>
      </div>
    </Card>
  )
}

// ─── Preview ─────────────────────────────────────────────────────────

function Preview({
  parsed,
  file,
  siteCode,
  setSiteCode,
  clientCode,
  setClientCode,
  jobName,
  setJobName,
  jobPin,
  setJobPin,
  onConfirm,
  onReset,
}: {
  parsed: ParsedTemplate
  file: File
  siteCode: string
  setSiteCode: (s: string) => void
  clientCode: string
  setClientCode: (s: string) => void
  jobName: string
  setJobName: (s: string) => void
  jobPin: string
  setJobPin: (s: string) => void
  onConfirm: () => void
  onReset: () => void
}) {
  const totalGreen = Object.values(parsed.fieldsByClassification).reduce(
    (a, fs) => a + fs.filter((f) => f.is_field_captured).length,
    0,
  )
  const totalDataPoints =
    parsed.assets.length *
    ((parsed.detectedClassification &&
      parsed.fieldsByClassification[parsed.detectedClassification]?.filter(
        (f) => f.is_field_captured,
      ).length) ||
      0)

  return (
    <div className="flex flex-col gap-4">
      {/* File summary */}
      <Card padding={0}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="w-9 h-9 rounded-md bg-ice text-sky-deep flex items-center justify-center shrink-0">
            <FileText size={16} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold font-mono text-ink truncate">{file.name}</div>
            <div className="text-[11px] text-muted">
              {parsed.assets.length} rows · {parsed.classifications.length} classification
              {parsed.classifications.length === 1 ? '' : 's'}
              {parsed.detectedClassification && (
                <>
                  {' '}
                  · detected <b>{parsed.detectedClassification}</b>
                </>
              )}
            </div>
          </div>
          <Pill tone="ok" size="sm">
            Auto-mapped {totalGreen}
          </Pill>
          <Button size="sm" variant="ghost" onClick={onReset}>
            Change
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <Stat label="Assets" value={`${parsed.assets.length}`} />
          <Stat label="Classifications" value={`${parsed.classifications.length}`} />
          <Stat label="Green fields" value={`${totalGreen}`} />
          <Stat label="Data points" value={totalDataPoints ? `${totalDataPoints}` : '—'} />
        </div>
      </Card>

      {/* Warnings */}
      {parsed.warnings.length > 0 && (
        <Card className="border-warn/40 bg-warn-bg">
          <div className="flex items-center gap-2 text-[13px] font-bold text-ink mb-2">
            <AlertTriangle size={14} strokeWidth={2.5} className="text-warn" />
            Warnings
          </div>
          <ul className="text-[12px] text-muted list-disc pl-5 space-y-1">
            {parsed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Job details */}
      <Card>
        <div className="text-[14px] font-bold text-ink mb-3">Job details</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Site code">
            <input
              value={siteCode}
              onChange={(e) => setSiteCode(e.target.value)}
              placeholder="SY6"
              className="field-input"
            />
          </Field>
          <Field label="Client code" hint="Internal code — never surface real client names">
            <input
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
              placeholder="DCCA"
              className="field-input"
            />
          </Field>

          {parsed.classifications.length === 1 && (
            <Field label="Job name" className="md:col-span-2">
              <input
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                className="field-input"
              />
            </Field>
          )}

          <Field
            label="Job PIN (optional)"
            hint="Field tech will be prompted for this PIN. Share out-of-band."
            className="md:col-span-2"
          >
            <input
              value={jobPin}
              onChange={(e) => setJobPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="Leave blank for open access"
              className="field-input mono"
            />
          </Field>
        </div>

        {parsed.classifications.length > 1 && (
          <div className="text-[12px] text-muted p-3 mt-3 rounded-md bg-ice border border-border">
            One job will be created per classification: {parsed.classifications.join(', ')}
          </div>
        )}
      </Card>

      {/* Classification breakdowns */}
      <div className="flex flex-col gap-2">
        {parsed.classifications.map((cls) => {
          const fs = parsed.fieldsByClassification[cls] ?? []
          const green = fs.filter((f) => f.is_field_captured)
          const assetCount = parsed.assets.filter((a) => a.classification_code === cls).length
          return (
            <details key={cls} open={parsed.classifications.length === 1}>
              <summary className="cursor-pointer list-none">
                <Card className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-bold text-ink">{cls}</div>
                    <div className="text-[11px] text-muted">
                      {assetCount} asset{assetCount === 1 ? '' : 's'} · {green.length}/{fs.length}{' '}
                      green fields
                    </div>
                  </div>
                  <Pill size="sm" tone="info">
                    {green.length} capture
                  </Pill>
                </Card>
              </summary>
              <div className="mt-2 px-1 grid grid-cols-1 md:grid-cols-2 gap-1">
                {green.map((f) => (
                  <div
                    key={f.spec_id}
                    className="flex items-center gap-2 py-1.5 text-[12px] border-b border-gray-100 last:border-b-0"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
                    <span className="font-mono text-[11px] truncate" title={f.display_name}>
                      {f.display_name}
                    </span>
                    <span className="ml-auto text-[10px] text-muted font-mono">{f.data_type}</span>
                  </div>
                ))}
              </div>
            </details>
          )
        })}
      </div>

      {/* Sticky footer action bar */}
      <div className="sticky bottom-0 -mx-2 md:mx-0 bg-gray-50 pt-3 pb-1">
        <div className="flex gap-2">
          <Button size="lg" variant="ghost" onClick={onReset} className="flex-1">
            Cancel
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={!siteCode.trim()}
            onClick={onConfirm}
            iconRight={ArrowRight}
            className="flex-[2]"
          >
            Create {parsed.classifications.length > 1 ? `${parsed.classifications.length} jobs` : 'job'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ──────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-bold uppercase tracking-[0.06em] text-muted mb-1">
        {label}
      </label>
      {children}
      {hint && <div className="text-[10px] text-muted mt-1">{hint}</div>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className="text-[18px] font-bold font-mono text-ink mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

// Suppress unused-import warning when the UI doesn't render the Plus icon in
// every branch but keeps it in scope for the "Create" CTA variant.
const _ensureIconsKept = { Plus }
void _ensureIconsKept
