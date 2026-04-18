import { useState } from 'react'
import { navigate } from '../lib/router'
import { TopBar } from '../components/TopBar'
import { parseTemplate, type ParsedTemplate } from '../lib/templateParser'
import { supabase } from '../lib/supabase'

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

  const onFile = async (f: File) => {
    setFile(f)
    setStage('parsing')
    setError(null)
    try {
      const p = await parseTemplate(f)
      setParsed(p)
      setSiteCode(p.detectedSite ?? '')
      if (p.detectedSite && p.detectedClassification) {
        setJobName(`${p.detectedSite} ${p.detectedClassification} — Asset Capture`)
      }
      setStage('preview')
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setStage('error')
    }
  }

  const create = async () => {
    if (!parsed || !siteCode.trim()) return
    setStage('creating')
    setError(null)
    try {
      // Ensure classification rows exist (for new-to-us classifications we
      // won't create them here — they're part of the pre-seed. But fields
      // might need updating.)
      const createdIds: string[] = []
      const createdSlugs: Array<string | null> = []

      // Simple slug: site-classification, lowercased, unique-suffix if taken
      const makeSlug = (site: string, cls: string) =>
        `${site}-${cls}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')

      for (const cls of parsed.classifications) {
        // 1. Upsert classification_fields for this classification
        const fields = parsed.fieldsByClassification[cls] ?? []
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
          if (fErr) throw new Error(`Field upsert failed for ${cls}: ${fErr.message}`)
        }

        // 2. Create the job
        const baseSlug = makeSlug(siteCode.trim(), cls)
        let slug: string | null = baseSlug
        // Check if slug already exists; append -2, -3 etc. if needed
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
        const jobResp = await supabase.from('jobs').insert(jobRow as never).select('id, slug').single()
        if (jobResp.error) throw new Error(`Job creation failed: ${jobResp.error.message}`)
        const newJob = jobResp.data as { id: string; slug: string | null }
        const newJobId = newJob.id
        createdIds.push(newJobId)
        createdSlugs.push(newJob.slug)

        // Optional PIN
        if (jobPin.trim().length === 4 && /^\d{4}$/.test(jobPin.trim())) {
          const { error: pinErr } = await supabase.rpc('set_job_pin' as never, {
            job: newJobId,
            new_pin: jobPin.trim(),
          } as never)
          if (pinErr) {
            console.warn('Could not set PIN:', pinErr.message)
          }
        }

        // 3. Insert the assets for this classification
        const clsAssets = parsed.assets.filter((a) => a.classification_code === cls)
        if (clsAssets.length > 0) {
          const assetRows = clsAssets.map((a) => ({
            job_id: newJobId,
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
          // Chunk to avoid Supabase's default payload limit for wide rows
          const CHUNK = 100
          for (let i = 0; i < assetRows.length; i += CHUNK) {
            const { error: aErr } = await supabase
              .from('assets')
              .insert(assetRows.slice(i, i + CHUNK) as never)
            if (aErr) throw new Error(`Asset insert failed: ${aErr.message}`)
          }
        }
      }

      setCreatedJobIds(createdIds)
      setCreatedJobSlugs(createdSlugs)
      setStage('done')
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setStage('error')
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="Import template" subtitle="Onboard a new asset capture job" onBack={() => navigate('/')} />

      <div className="flex-1 px-4 pt-4 pb-6 space-y-4 max-w-3xl mx-auto w-full">
        {stage === 'idle' && <Uploader onFile={onFile} />}
        {stage === 'parsing' && (
          <div className="card p-8 text-center">
            <div className="text-3xl mb-2">⏳</div>
            <div className="font-bold">Parsing template…</div>
            <div className="text-sm text-muted">Reading sheets, detecting green cells, extracting LOVs</div>
          </div>
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
          <div className="card p-8 text-center">
            <div className="text-3xl mb-2">⏳</div>
            <div className="font-bold">Creating job{parsed && parsed.classifications.length > 1 ? 's' : ''}…</div>
            <div className="text-sm text-muted">Inserting fields and assets</div>
          </div>
        )}

        {stage === 'done' && (
          <div className="card p-6 border-ok/40 bg-ok/5">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">✅</div>
              <div>
                <div className="font-bold text-ink">Job created</div>
                <div className="text-sm text-muted">
                  {createdJobIds.length} job{createdJobIds.length === 1 ? '' : 's'} ready for field capture
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {createdJobIds.map((id: string, idx: number) => {
                const slug = createdJobSlugs[idx]
                const displayRef = slug ?? id
                return (
                  <div key={id} className="flex items-center gap-2">
                    <code className="text-xs mono bg-white px-2 py-1 rounded border border-border truncate flex-1">
                      /#/j/{displayRef}
                    </code>
                    <button onClick={() => navigate(`/j/${displayRef}`)} className="btn btn-primary btn-md">
                      Open
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              onClick={() => {
                setStage('idle')
                setParsed(null)
                setFile(null)
                setCreatedJobIds([])
              }}
              className="btn btn-ghost btn-md w-full mt-4"
            >
              Import another
            </button>
          </div>
        )}

        {stage === 'error' && (
          <div className="card p-6 border-bad/40 bg-bad/5">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">❌</div>
              <div>
                <div className="font-bold text-ink">Import failed</div>
                <div className="text-sm text-muted">See details below</div>
              </div>
            </div>
            <pre className="text-xs mono bg-white p-3 rounded border border-border overflow-x-auto">
              {error}
            </pre>
            <button onClick={() => setStage('idle')} className="btn btn-ghost btn-md w-full mt-3">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Uploader({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    <div>
      <div className="card p-4 mb-4">
        <h2 className="font-bold text-ink mb-1">How it works</h2>
        <ol className="text-sm text-muted space-y-1 list-decimal pl-5">
          <li>Upload the Equinix-format .xlsm or .xlsx template</li>
          <li>We parse the green cells, asset rows, classifications, and LOVs</li>
          <li>You confirm the site code and job name</li>
          <li>A job is created with everything ready for field capture</li>
        </ol>
      </div>
      <label
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
        className={`block card p-10 text-center cursor-pointer border-2 border-dashed transition ${
          dragging ? 'border-sky bg-sky-soft' : 'border-border hover:border-sky/60'
        }`}
      >
        <div className="text-4xl mb-2">📋</div>
        <div className="font-bold text-ink">Drop the Equinix template here</div>
        <div className="text-sm text-muted mb-3">or click to browse</div>
        <input
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
          }}
        />
      </label>
    </div>
  )
}

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
  const totalDataPoints = parsed.assets.length *
    ((parsed.detectedClassification &&
      parsed.fieldsByClassification[parsed.detectedClassification]?.filter((f) => f.is_field_captured).length) ||
      0)

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">File</div>
            <div className="font-semibold text-ink mono text-sm truncate">{file.name}</div>
          </div>
          <button onClick={onReset} className="btn btn-ghost btn-md">
            Change
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Stat label="Assets" value={`${parsed.assets.length}`} />
          <Stat label="Classifications" value={`${parsed.classifications.length}`} />
          <Stat label="Green fields" value={`${totalGreen}`} />
          <Stat label="Data points" value={totalDataPoints ? `${totalDataPoints}` : '—'} />
        </div>
      </div>

      {parsed.warnings.length > 0 && (
        <div className="card p-4 border-warn/40 bg-warn/5">
          <div className="font-bold text-sm mb-2">Warnings</div>
          <ul className="text-sm text-muted list-disc pl-5 space-y-1">
            {parsed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <h2 className="font-bold text-ink">Job details</h2>

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted block mb-1">
            Site code
          </label>
          <input
            value={siteCode}
            onChange={(e) => setSiteCode(e.target.value)}
            placeholder="SY6"
            className="field-input"
          />
        </div>

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted block mb-1">
            Client code
          </label>
          <input
            value={clientCode}
            onChange={(e) => setClientCode(e.target.value)}
            placeholder="DCCA"
            className="field-input"
          />
          <div className="text-[10px] text-muted mt-1">Internal code — never surface real client names</div>
        </div>

        {parsed.classifications.length === 1 && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted block mb-1">
              Job name
            </label>
            <input
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              className="field-input"
            />
          </div>
        )}

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted block mb-1">
            Job PIN (optional, 4 digits)
          </label>
          <input
            value={jobPin}
            onChange={(e) => setJobPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="Leave blank for open access"
            className="field-input mono"
          />
          <div className="text-[10px] text-muted mt-1">
            Field tech will be prompted for this PIN. Share out-of-band (SMS, phone call).
          </div>
        </div>

        {parsed.classifications.length > 1 && (
          <div className="text-xs text-muted p-3 rounded bg-sky-soft border border-border">
            One job will be created per classification: {parsed.classifications.join(', ')}
          </div>
        )}
      </div>

      {/* Classification breakdowns */}
      <div className="space-y-2">
        {parsed.classifications.map((cls) => {
          const fs = parsed.fieldsByClassification[cls] ?? []
          const green = fs.filter((f) => f.is_field_captured)
          const assetCount = parsed.assets.filter((a) => a.classification_code === cls).length
          return (
            <details key={cls} className="card p-4" open={parsed.classifications.length === 1}>
              <summary className="cursor-pointer flex items-center justify-between select-none">
                <div>
                  <div className="font-bold text-ink">{cls}</div>
                  <div className="text-xs text-muted">
                    {assetCount} asset{assetCount === 1 ? '' : 's'} · {green.length}/{fs.length} green fields
                  </div>
                </div>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </summary>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
                {green.map((f) => (
                  <div key={f.spec_id} className="flex items-center gap-2 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
                    <span className="font-mono text-[11px] truncate" title={f.display_name}>
                      {f.display_name}
                    </span>
                    <span className="ml-auto text-[10px] text-muted mono">{f.data_type}</span>
                  </div>
                ))}
              </div>

              {fs.length > green.length && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted">
                    {fs.length - green.length} office-filled fields (not part of capture)
                  </summary>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                    {fs
                      .filter((f) => !f.is_field_captured)
                      .map((f) => (
                        <div key={f.spec_id} className="flex items-center gap-2 py-1 text-muted">
                          <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
                          <span className="font-mono text-[11px] truncate">{f.display_name}</span>
                        </div>
                      ))}
                  </div>
                </details>
              )}
            </details>
          )
        })}
      </div>

      <div className="flex gap-2 sticky bottom-4">
        <button onClick={onReset} className="btn btn-ghost btn-lg flex-1">
          Cancel
        </button>
        <button
          disabled={!siteCode.trim()}
          onClick={onConfirm}
          className="btn btn-primary btn-lg flex-[2] disabled:opacity-40"
        >
          Create job & continue
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="text-xl font-bold text-ink mono">{value}</div>
    </div>
  )
}
