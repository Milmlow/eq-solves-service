import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  Grid3x3,
  Upload,
  X,
} from 'lucide-react'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import {
  allCaptures,
  pendingCount,
  subscribeQueue,
  syncPending,
} from '../lib/queue'
import { supabase } from '../lib/supabase'
import { downloadCompletedWorkbook, downloadCsv } from '../lib/export'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { MetaRow } from '../components/ui/MetaRow'
import { Pill } from '../components/ui/Pill'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Toggle } from '../components/ui/Toggle'

type OutputKey = 'xlsx' | 'csv'

type OutputDef = {
  key: OutputKey
  label: string
  sub: string
  icon: LucideIcon
  available: boolean
  unavailableReason?: string
}

type Check = {
  label: string
  state: 'ok' | 'warn' | 'bad'
  detail?: string
}

export function ExportPage({ jobRef }: { jobRef: string }) {
  const { job } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)

  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [selected, setSelected] = useState<Record<OutputKey, boolean>>({
    xlsx: false,
    csv: true,
  })
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastGenerated, setLastGenerated] = useState<string | null>(null)

  // Live re-render on queue changes
  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick((v) => v + 1)), [])
  const pending = pendingCount()

  const requiredFieldIds = useMemo(
    () => new Set(fields.filter((f) => f.is_field_captured).map((f) => f.id)),
    [fields],
  )
  const requiredCount = requiredFieldIds.size
  const totalCells = assets.length * requiredCount

  // ─── Stats derived from queue ────────────────────────────────────────────
  const { filledCells, completeAssets, flaggedAssets } = useMemo(() => {
    const captures = allCaptures()
    const assetIds = new Set(assets.map((a) => a.id))

    const filledPerAsset = new Map<string, number>()
    const flaggedPerAsset = new Set<string>()

    for (const c of captures) {
      if (!assetIds.has(c.assetId)) continue
      if (!requiredFieldIds.has(c.classificationFieldId)) continue
      if (c.flagged) flaggedPerAsset.add(c.assetId)
      if (c.value && c.value.trim() !== '') {
        filledPerAsset.set(c.assetId, (filledPerAsset.get(c.assetId) ?? 0) + 1)
      }
    }

    let filledCells = 0
    let completeAssets = 0
    for (const a of assets) {
      const n = filledPerAsset.get(a.id) ?? 0
      filledCells += n
      if (n === requiredCount && requiredCount > 0) completeAssets += 1
    }
    return { filledCells, completeAssets, flaggedAssets: flaggedPerAsset.size }
  }, [assets, requiredFieldIds, requiredCount, pending])

  // ─── Pre-export checks ───────────────────────────────────────────────────
  const checks: Check[] = useMemo(() => {
    const list: Check[] = []
    const gap = assets.length - completeAssets
    list.push(
      requiredCount === 0
        ? {
            label: 'Classification has no required fields',
            state: 'warn',
            detail: 'nothing to capture',
          }
        : gap === 0 && assets.length > 0
          ? {
              label: `All ${requiredCount} required fields captured on every asset`,
              state: 'ok',
            }
          : {
              label: `All ${requiredCount} required fields captured on every asset`,
              state: gap === assets.length ? 'bad' : 'warn',
              detail: `${gap} asset${gap === 1 ? '' : 's'} with gaps`,
            },
    )
    list.push(
      flaggedAssets === 0
        ? { label: 'No flagged items remain', state: 'ok' }
        : {
            label: 'No flagged items remain',
            state: 'bad',
            detail: `${flaggedAssets} flagged — resolve or mark "accepted"`,
          },
    )
    list.push(
      pending === 0
        ? { label: 'Local queue synced to server', state: 'ok' }
        : {
            label: 'Local queue synced to server',
            state: 'warn',
            detail: `${pending} pending — will auto-sync on export`,
          },
    )
    list.push(
      templateFile
        ? {
            label: 'Template workbook uploaded',
            state: 'ok',
            detail: templateFile.name,
          }
        : {
            label: 'Template workbook uploaded',
            state: 'warn',
            detail: 'needed only if XLSX is selected',
          },
    )
    return list
  }, [
    assets.length,
    completeAssets,
    requiredCount,
    flaggedAssets,
    pending,
    templateFile,
  ])

  // ─── Output definitions ──────────────────────────────────────────────────
  const outputs: OutputDef[] = useMemo(() => {
    return [
      {
        key: 'xlsx',
        label: 'Completed workbook (XLSX)',
        sub: templateFile
          ? `${templateFile.name} · green cells filled from captures`
          : 'Upload the original Equinix template below',
        icon: FileSpreadsheet,
        available: !!templateFile,
        unavailableReason: 'Upload template to enable',
      },
      {
        key: 'csv',
        label: 'Flat CSV',
        sub: 'One row per capture · asset, field, value, who, when, notes',
        icon: FileText,
        available: true,
      },
    ]
  }, [templateFile])

  // Disable toggles whose availability changed
  useEffect(() => {
    if (!templateFile && selected.xlsx) {
      setSelected((s) => ({ ...s, xlsx: false }))
    }
  }, [templateFile, selected.xlsx])

  const anySelected = outputs.some((o) => selected[o.key] && o.available)
  const baseFilename = job
    ? `${job.site_code}_${job.classification_code}_${new Date()
        .toISOString()
        .slice(0, 10)}`
    : 'export'

  // ─── Generate ────────────────────────────────────────────────────────────
  const generate = async () => {
    if (!job) return
    if (!anySelected) return
    setError(null)
    setBuilding(true)
    try {
      if (pendingCount() > 0) await syncPending()

      // XLSX
      if (selected.xlsx && templateFile) {
        const { data: serverCaptures, error: sErr } = await supabase
          .from('captures')
          .select('asset_id, classification_field_id, value')
          .in(
            'asset_id',
            assets.map((a) => a.id),
          )
        if (sErr) throw sErr
        await downloadCompletedWorkbook({
          templateFile,
          job,
          assets,
          fields,
          captures: (serverCaptures ?? []) as Array<{
            asset_id: string
            classification_field_id: number
            value: string | null
          }>,
        })
      }

      // CSV
      if (selected.csv) {
        const { data: serverCaptures, error: sErr } = await supabase
          .from('captures')
          .select(
            'asset_id, classification_field_id, value, captured_by, captured_at, notes, flagged',
          )
          .in(
            'asset_id',
            assets.map((a) => a.id),
          )
        if (sErr) throw sErr
        downloadCsv({
          job,
          assets,
          fields,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          captures: (serverCaptures ?? []) as any[],
        })
      }

      setLastGenerated(new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBuilding(false)
    }
  }

  const progressPct = totalCells ? Math.round((filledCells / totalCells) * 100) : 0

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* ── Grid: 1fr / 320px ──────────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-3.5 min-w-0">
          {/* Package contents */}
          <Card padding={0}>
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-[14px] font-bold text-ink">Package contents</div>
              <div className="text-[12px] text-muted mt-0.5">
                Toggle the formats you want in the handover package.
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {outputs.map((o) => {
                const Icon = o.icon
                const isOn = o.available && selected[o.key]
                return (
                  <div
                    key={o.key}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-ice shrink-0 text-sky-deep">
                      <Icon size={14} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink">
                        {o.label}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {o.sub}
                      </div>
                    </div>
                    {o.available ? (
                      <Toggle
                        checked={isOn}
                        onChange={(v) =>
                          setSelected((s) => ({ ...s, [o.key]: v }))
                        }
                      />
                    ) : (
                      <Pill tone="neutral" size="sm">
                        {o.unavailableReason ?? 'Unavailable'}
                      </Pill>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Template upload */}
          <Card padding={0}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-[14px] font-bold text-ink">
                  Equinix template
                </div>
                <div className="text-[12px] text-muted mt-0.5">
                  Required for the XLSX output · preserves validations, formulas, formatting.
                </div>
              </div>
              {templateFile && (
                <Pill tone="ok" size="sm">
                  <Check size={10} strokeWidth={2.5} />
                  Loaded
                </Pill>
              )}
            </div>
            <div className="p-4">
              <label
                className={
                  'flex items-center gap-3 rounded-lg border-2 border-dashed ' +
                  (templateFile
                    ? 'border-ok bg-ok-bg'
                    : 'border-gray-300 bg-gray-50 hover:border-sky') +
                  ' px-4 py-3.5 cursor-pointer transition-colors'
                }
              >
                <div
                  className={
                    'flex items-center justify-center h-9 w-9 rounded-md shrink-0 ' +
                    (templateFile
                      ? 'bg-white text-ok-fg'
                      : 'bg-white text-sky-deep')
                  }
                >
                  <Upload size={16} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink truncate">
                    {templateFile
                      ? templateFile.name
                      : 'Click to upload .xlsm / .xlsx template'}
                  </div>
                  <div className="text-[11px] text-muted">
                    {templateFile
                      ? `${Math.round(templateFile.size / 1024)} KB · ready`
                      : 'We fill the green cells and hand it back untouched elsewhere.'}
                  </div>
                </div>
                {templateFile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      setTemplateFile(null)
                    }}
                    className="shrink-0 text-muted hover:text-bad-fg transition-colors"
                    aria-label="Remove template"
                  >
                    <X size={16} strokeWidth={2} />
                  </button>
                )}
                <input
                  type="file"
                  accept=".xlsm,.xlsx"
                  className="hidden"
                  onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </Card>

          {/* Pre-export checks */}
          <Card padding={0}>
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-[14px] font-bold text-ink">Pre-export checks</div>
              <div className="text-[12px] text-muted mt-0.5">
                Not blockers — but worth a glance before handover.
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {checks.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 px-4 py-2.5"
                >
                  {c.state === 'ok' && (
                    <Check size={15} strokeWidth={2.5} className="text-ok-fg shrink-0" />
                  )}
                  {c.state === 'warn' && (
                    <AlertTriangle
                      size={15}
                      strokeWidth={2}
                      className="text-warn-fg shrink-0"
                    />
                  )}
                  {c.state === 'bad' && (
                    <X size={15} strokeWidth={2.5} className="text-bad-fg shrink-0" />
                  )}
                  <div className="flex-1 text-[13px] text-ink">{c.label}</div>
                  {c.detail && (
                    <span className="text-[11px] text-muted truncate max-w-[240px]">
                      {c.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Coming soon — aspirational but disabled */}
          <Card padding={0}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-[14px] font-bold text-ink">Coming soon</div>
              <Pill tone="neutral" size="sm">
                Not in this build
              </Pill>
            </div>
            <div className="divide-y divide-gray-100">
              {[
                {
                  label: 'Photos bundle (ZIP)',
                  sub: 'Named {asset}_{kind}.jpg · keeps EXIF',
                  icon: Camera,
                },
                {
                  label: 'Coverage matrix (PDF)',
                  sub: 'One-page QA sign-off — asset × field grid',
                  icon: Grid3x3,
                },
              ].map((r, i) => {
                const Icon = r.icon
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-3 opacity-60"
                  >
                    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-gray-100 shrink-0 text-muted">
                      <Icon size={14} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink">
                        {r.label}
                      </div>
                      <div className="text-[11px] text-muted">{r.sub}</div>
                    </div>
                    <Toggle checked={false} disabled onChange={() => {}} />
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        {/* ── Right column (sticky summary) ────────────────────────── */}
        <div className="flex flex-col gap-3.5 min-w-0">
          <Card padding={0} className="sticky top-4 self-start">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-[13px] font-bold text-ink">Summary</div>
            </div>
            <div className="p-4 flex flex-col gap-0.5">
              <MetaRow label="Assets" mono>
                {assets.length}
              </MetaRow>
              <MetaRow label="Captured" mono>
                {completeAssets}/{assets.length}
              </MetaRow>
              <MetaRow label="Data points" mono>
                {filledCells}/{totalCells || 0}
              </MetaRow>
              <MetaRow label="Flagged" mono>
                {flaggedAssets}
              </MetaRow>
              <MetaRow label="Filename" mono>
                <span className="break-all">{baseFilename}</span>
              </MetaRow>
            </div>
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between mb-1.5 text-[11px] text-muted tabular-nums">
                <span>Progress</span>
                <span className="font-mono">{progressPct}%</span>
              </div>
              <ProgressBar done={filledCells} total={totalCells} height={6} />
            </div>
            <div className="p-4 pt-0">
              <Button
                variant="primary"
                size="lg"
                icon={Download}
                onClick={generate}
                disabled={building || !anySelected || !job}
                className="w-full"
              >
                {building ? 'Generating…' : 'Generate package'}
              </Button>
              <div className="mt-2 text-[11px] text-muted text-center">
                {!anySelected
                  ? 'Select at least one output above'
                  : pending > 0
                    ? 'Will auto-sync before export'
                    : lastGenerated
                      ? `Last generated ${new Date(lastGenerated).toLocaleTimeString()}`
                      : 'Saves directly to your Downloads'}
              </div>
            </div>
          </Card>

          {error && (
            <Card className="bg-bad-bg border-bad">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={14}
                  strokeWidth={2}
                  className="text-bad-fg shrink-0 mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-bad-fg">
                    Export failed
                  </div>
                  <div className="text-[12px] text-bad-fg/80 mt-0.5 break-words">
                    {error}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
