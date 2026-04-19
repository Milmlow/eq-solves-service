import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  Flag,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { supabase } from '../lib/supabase'
import { allCaptures, enqueueCapture, subscribeQueue } from '../lib/queue'
import { CAPTURED_BY_KEY } from '../lib/constants'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ProgressBar } from '../components/ui/ProgressBar'
import { cn } from '../lib/cn'
import type { Asset, ClassificationField } from '../types/db'

interface Capture {
  asset_id: string
  classification_field_id: number
  value: string | null
  captured_by: string | null
  captured_at: string
  flagged: boolean
  notes: string | null
}

/**
 * Progress matrix (v2 Admin view) — every asset × every required field.
 * Vertical field headers, sticky first column, click any cell to open that
 * asset's capture page.
 */
export function AdminPage({ jobRef }: { jobRef: string }) {
  const { job } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)
  const [serverCaptures, setServerCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [importDialog, setImportDialog] = useState(false)

  const openImport = () => setImportDialog(true)

  // Re-render when queue changes so pending local captures show immediately
  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick((v) => v + 1)), [])

  const fieldsCaptured = useMemo(
    () => fields.filter((f) => f.is_field_captured),
    [fields],
  )

  const load = async () => {
    if (!assets.length) return
    setLoading(true)
    const { data, error } = await supabase
      .from('captures')
      .select('asset_id, classification_field_id, value, captured_by, captured_at, flagged, notes')
      .in('asset_id', assets.map((a) => a.id))
    if (!error && data) setServerCaptures(data as Capture[])
    setLoading(false)
    setLastFetch(new Date())
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.length])

  // Poll every 15s when tab focused
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.length])

  // Merge server + local queue — local wins (captures may be pending sync)
  const capByCell = useMemo(() => {
    const m = new Map<string, Capture>()
    for (const c of serverCaptures) m.set(`${c.asset_id}:${c.classification_field_id}`, c)
    for (const q of allCaptures()) {
      const key = `${q.assetId}:${q.classificationFieldId}`
      m.set(key, {
        asset_id: q.assetId,
        classification_field_id: q.classificationFieldId,
        value: q.value,
        captured_by: q.capturedBy,
        captured_at: q.capturedAt,
        flagged: q.flagged,
        notes: q.notes,
      })
    }
    return m
  }, [serverCaptures, assets])

  // Per-field coverage (column footer)
  const colCoverage = useMemo(() => {
    const m = new Map<number, { filled: number; total: number }>()
    for (const f of fieldsCaptured) {
      let filled = 0
      for (const a of assets) {
        const c = capByCell.get(`${a.id}:${f.id}`)
        if (c?.value && c.value.trim() !== '') filled += 1
      }
      m.set(f.id, { filled, total: assets.length })
    }
    return m
  }, [fieldsCaptured, assets, capByCell])

  // Overall stats
  const totals = useMemo(() => {
    const totalCells = assets.length * fieldsCaptured.length
    let filled = 0
    let flagged = 0
    const people = new Set<string>()
    for (const c of capByCell.values()) {
      if (c.value && c.value.trim() !== '') filled += 1
      if (c.flagged) flagged += 1
      if (c.captured_by) people.add(c.captured_by)
    }
    const assetsComplete = assets.filter((a) => {
      let done = 0
      for (const f of fieldsCaptured) {
        const c = capByCell.get(`${a.id}:${f.id}`)
        if (c?.value && c.value.trim() !== '') done += 1
      }
      return fieldsCaptured.length > 0 && done === fieldsCaptured.length
    }).length
    return { totalCells, filled, flagged, assetsComplete, people: people.size }
  }, [capByCell, assets, fieldsCaptured])

  const exportCsv = () => {
    const header = [
      'row_number',
      'asset_id',
      'description',
      ...fieldsCaptured.map((f) => f.display_name),
    ]
    const rows = assets.map((a) => {
      const vals = fieldsCaptured.map((f) => {
        const c = capByCell.get(`${a.id}:${f.id}`)
        const v = c?.value ?? ''
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v
      })
      return [a.row_number, a.asset_id ?? '', a.description, ...vals].join(',')
    })
    const csv = [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${job?.slug ?? jobRef}_matrix.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!assets.length) {
    return (
      <div className="max-w-[1320px] mx-auto">
        <div className="text-[13px] text-muted">Loading matrix…</div>
      </div>
    )
  }

  return (
    <div className="max-w-[1320px] mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <div className="text-[20px] font-bold tracking-[-0.01em] leading-tight">
            Progress matrix
          </div>
          <div className="text-[12px] text-muted mt-1">
            Every asset × every required field. Click any cell to jump straight to it.
            {lastFetch && (
              <span className="ml-2 text-gray-400">· Updated {formatRelative(lastFetch)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button size="sm" variant="ghost" icon={Upload} onClick={openImport}>
            Import CSV
          </Button>
          <Button size="sm" variant="ghost" icon={Download} onClick={exportCsv}>
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={FileSpreadsheet}
            onClick={() => navigate(`/j/${jobRef}/export`)}
            title="Full workbook export — needs the original .xlsm template"
          >
            Full export →
          </Button>
        </div>
      </div>

      {importDialog ? (
        <ImportDialog
          assets={assets}
          fields={fieldsCaptured}
          capByCell={capByCell}
          jobId={jobId}
          onClose={() => setImportDialog(false)}
          onImported={() => {
            setImportDialog(false)
            void load()
          }}
        />
      ) : null}

      {/* Top stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MatrixStat
          label="Assets complete"
          value={`${totals.assetsComplete}/${assets.length}`}
          tone={totals.assetsComplete === assets.length ? 'ok' : 'info'}
        />
        <MatrixStat
          label="Cells filled"
          value={`${totals.filled}/${totals.totalCells}`}
          sub={totals.totalCells ? `${Math.round((totals.filled / totals.totalCells) * 100)}%` : '—'}
        />
        <MatrixStat label="Capturers" value={totals.people} sub="field techs" />
        <MatrixStat
          label="Flagged"
          value={totals.flagged}
          tone={totals.flagged ? 'warn' : 'neutral'}
          sub="review required"
        />
      </div>

      {/* Matrix table */}
      <Card padding={0} className="overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-340px)]">
          <table className="border-collapse text-[11px] min-w-full">
            <thead>
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 bg-gray-50 px-3 py-2.5 text-left border-b border-r border-gray-200 min-w-[240px]"
                  style={{ verticalAlign: 'bottom' }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
                    Asset
                  </div>
                </th>
                {fieldsCaptured.map((f) => {
                  const c = colCoverage.get(f.id)!
                  const pct = c.total > 0 ? (c.filled / c.total) * 100 : 0
                  const color = pct === 100 ? '#16A34A' : pct > 50 ? '#3DA8D8' : '#D97706'
                  return (
                    <th
                      key={f.id}
                      className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-1.5 py-2 min-w-[60px]"
                      style={{ verticalAlign: 'bottom' }}
                      title={f.display_name}
                    >
                      <div
                        className="text-[10px] font-bold text-ink whitespace-nowrap mx-auto flex items-end"
                        style={{
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          height: 100,
                        }}
                      >
                        {f.display_name}
                      </div>
                      <div className="mt-1.5 px-1">
                        <ProgressBar done={c.filled} total={c.total} height={3} color={color} />
                        <div
                          className={cn(
                            'text-[9px] font-bold font-mono mt-0.5 text-center tabular-nums',
                            pct === 100 ? 'text-ok' : 'text-muted',
                          )}
                        >
                          {c.filled}/{c.total}
                        </div>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {assets.map((a, ri) => {
                const rowBg = ri % 2 ? 'bg-gray-50' : 'bg-white'
                let done = 0
                let rowFlagged = false
                for (const f of fieldsCaptured) {
                  const c = capByCell.get(`${a.id}:${f.id}`)
                  if (c?.value && c.value.trim() !== '') done += 1
                  if (c?.flagged) rowFlagged = true
                }
                const complete = fieldsCaptured.length > 0 && done === fieldsCaptured.length

                return (
                  <tr key={a.id} className="group">
                    <td
                      className={cn(
                        'sticky left-0 z-10 px-3 py-2 border-b border-r border-gray-100 whitespace-nowrap',
                        rowBg,
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/j/${jobRef}/a/${a.id}`)}
                        className="flex items-center gap-2 text-left cursor-pointer hover:text-sky-deep"
                      >
                        <code className="text-[10px] font-bold font-mono text-sky-deep">
                          #{a.row_number.toString().padStart(3, '0')}
                        </code>
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-ink leading-tight">
                            {a.asset_id ?? a.asset_uid ?? '—'}
                          </div>
                          <div className="text-[10px] text-muted truncate max-w-[160px]">
                            {a.description}
                          </div>
                        </div>
                        {rowFlagged && (
                          <Flag size={10} strokeWidth={2.5} className="text-bad ml-1 shrink-0" />
                        )}
                        {complete && (
                          <Check size={12} strokeWidth={2.5} className="text-ok ml-1 shrink-0" />
                        )}
                      </button>
                    </td>
                    {fieldsCaptured.map((f) => {
                      const c = capByCell.get(`${a.id}:${f.id}`)
                      return (
                        <td
                          key={f.id}
                          className={cn('p-0 border-b border-gray-100', rowBg)}
                        >
                          <MatrixCell
                            value={c?.value ?? null}
                            flagged={Boolean(c?.flagged)}
                            fieldName={f.display_name}
                            onClick={() => navigate(`/j/${jobRef}/a/${a.id}`)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-[11px] text-muted flex-wrap">
        <LegendSwatch color="#F0FDF4" border="#16A34A" label="Captured" />
        <LegendSwatch color="#FFFBEB" border="#D97706" label="Flagged" />
        <LegendSwatch color="#F9FAFB" border="#D1D5DB" label="Empty" />
        <div className="ml-auto">Click any cell to open that asset.</div>
      </div>
    </div>
  )
}

// ─── Internals ────────────────────────────────────────────────────────────

function MatrixCell({
  value,
  flagged,
  fieldName,
  onClick,
}: {
  value: string | null
  flagged: boolean
  fieldName: string
  onClick: () => void
}) {
  const hasVal = Boolean(value && value.trim())
  const short = hasVal
    ? value!.length > 8
      ? value!.slice(0, 7) + '…'
      : value!
    : ''
  return (
    <button
      type="button"
      onClick={onClick}
      title={hasVal ? `${fieldName}: ${value}` : `${fieldName} — not captured`}
      className={cn(
        'h-[34px] min-w-[60px] w-full flex items-center justify-center cursor-pointer',
        'text-[10px] font-semibold font-mono border-r border-gray-100',
        'transition-colors duration-120',
        flagged
          ? 'bg-[#FFFBEB] text-[#B45309] hover:bg-[#FEF3C7]'
          : hasVal
            ? 'bg-[#F0FDF4] text-[#15803D] hover:bg-[#DCFCE7]'
            : 'bg-transparent text-gray-300 hover:bg-gray-100',
      )}
    >
      {hasVal ? short : '—'}
    </button>
  )
}

function MatrixStat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'neutral' | 'info' | 'ok' | 'warn'
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'info'
          ? 'text-sky-deep'
          : 'text-ink'
  return (
    <Card padding={14}>
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={cn('font-mono font-bold text-[22px] leading-none mt-1.5 tabular-nums', toneCls)}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-1">{sub}</div>}
    </Card>
  )
}

function LegendSwatch({
  color,
  border,
  label,
}: {
  color: string
  border: string
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-3.5 h-3.5 rounded-sm"
        style={{ background: color, border: `1px solid ${border}` }}
      />
      <span>{label}</span>
    </div>
  )
}

function formatRelative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString()
}

// ─── CSV import ──────────────────────────────────────────────────────────
//
// Matches the shape that `exportCsv` writes: header row of
//   row_number, asset_id, description, <field display_name 1>, <field 2>, …
// Merge rule (per product decision 2026-04-19): CSV wins on conflict.
//   - blank cell in CSV → skip (never clears existing)
//   - value in CSV, current empty → add
//   - value in CSV, current differs → overwrite with CSV value
//   - value in CSV matches current → no-op
// Every imported cell is stamped with the current device's capturer name,
// falling back to "CSV Import" so provenance is visible in the admin view.

type ImportDiff = {
  add: number
  overwrite: number
  unchanged: number
  skippedBlank: number
  unmatchedAssets: string[]
  unmatchedFields: string[]
  // Flat list of operations that will be enqueued on confirm.
  ops: Array<{
    assetId: string
    classificationFieldId: number
    value: string
    prev: string | null
  }>
}

function ImportDialog({
  assets,
  fields,
  capByCell,
  jobId,
  onClose,
  onImported,
}: {
  assets: Asset[]
  fields: ClassificationField[]
  capByCell: Map<string, Capture>
  jobId: string | null
  onClose: () => void
  onImported: () => void
}) {
  const [stage, setStage] = useState<'pick' | 'preview' | 'importing' | 'done' | 'error'>('pick')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [diff, setDiff] = useState<ImportDiff | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = async (f: File) => {
    setFileName(f.name)
    setError(null)
    try {
      const text = await f.text()
      const d = computeDiff(text, assets, fields, capByCell)
      setDiff(d)
      setStage('preview')
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setStage('error')
    }
  }

  const confirm = async () => {
    if (!diff || !jobId) return
    setStage('importing')
    const capturedBy =
      (typeof localStorage !== 'undefined' && localStorage.getItem(CAPTURED_BY_KEY)) || 'CSV Import'
    for (const op of diff.ops) {
      enqueueCapture({
        jobId,
        assetId: op.assetId,
        classificationFieldId: op.classificationFieldId,
        value: op.value,
        capturedBy,
        flagged: false,
        notes: null,
      })
    }
    setStage('done')
    // Small delay so the user sees the success state before the panel auto-closes
    setTimeout(onImported, 700)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-gray-200 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-sky-deep" />
            <div className="font-bold text-[15px]">Import CSV</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {stage === 'pick' && (
            <>
              <p className="text-[13px] text-ink leading-relaxed">
                Import a CSV in the same shape this page exports (columns:
                {' '}<code className="mono text-[12px] text-sky-deep">row_number, asset_id, description, …fields</code>).
              </p>
              <div className="mt-3 text-[12px] text-muted leading-relaxed">
                <div className="font-semibold text-ink mb-1">How the merge works</div>
                <div>• If a CSV cell is blank, the existing value is kept (never cleared).</div>
                <div>• If a CSV cell has a value, it wins — even over values captured on phones.</div>
                <div>• Every imported cell is stamped with your capturer name.</div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onFile(f)
                }}
              />
              <div className="mt-4">
                <Button
                  variant="primary"
                  icon={Upload}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose CSV file
                </Button>
              </div>
            </>
          )}

          {stage === 'preview' && diff && (
            <>
              <div className="text-[12px] text-muted">{fileName}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <DiffStat label="Will add" value={diff.add} tone="ok" />
                <DiffStat label="Will overwrite" value={diff.overwrite} tone="warn" />
                <DiffStat label="Unchanged" value={diff.unchanged} tone="neutral" />
                <DiffStat label="Blank in CSV (skipped)" value={diff.skippedBlank} tone="neutral" />
              </div>

              {(diff.unmatchedAssets.length > 0 || diff.unmatchedFields.length > 0) && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-warn-bg/40 border border-warn-bg">
                  <AlertTriangle size={14} className="text-warn mt-0.5 shrink-0" />
                  <div className="text-[12px]">
                    {diff.unmatchedAssets.length > 0 && (
                      <div>
                        <b>Skipped {diff.unmatchedAssets.length} unknown asset
                        {diff.unmatchedAssets.length === 1 ? '' : 's'}:</b>{' '}
                        <span className="mono text-[11px]">
                          {diff.unmatchedAssets.slice(0, 6).join(', ')}
                          {diff.unmatchedAssets.length > 6 ? '…' : ''}
                        </span>
                      </div>
                    )}
                    {diff.unmatchedFields.length > 0 && (
                      <div className="mt-1">
                        <b>Skipped {diff.unmatchedFields.length} unknown column
                        {diff.unmatchedFields.length === 1 ? '' : 's'}:</b>{' '}
                        <span className="mono text-[11px]">
                          {diff.unmatchedFields.slice(0, 6).join(', ')}
                          {diff.unmatchedFields.length > 6 ? '…' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {diff.overwrite > 0 && (
                <div className="mt-3 p-3 rounded-md bg-bad-bg/40 border border-bad-bg text-[12px]">
                  <div className="font-semibold text-bad-fg flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    {diff.overwrite} cell{diff.overwrite === 1 ? '' : 's'} will be overwritten
                  </div>
                  <div className="text-muted mt-1">
                    These have existing values captured on phones. CSV values win — the phone
                    values will be replaced.
                  </div>
                </div>
              )}
            </>
          )}

          {stage === 'importing' && (
            <div className="py-6 text-center text-[13px] text-muted">
              Queuing {diff?.ops.length ?? 0} captures…
            </div>
          )}

          {stage === 'done' && (
            <div className="py-6 text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-ok-bg flex items-center justify-center">
                <Check size={18} className="text-ok" />
              </div>
              <div className="mt-2 text-[14px] font-semibold text-ink">Import queued</div>
              <div className="text-[12px] text-muted mt-1">
                {diff?.ops.length ?? 0} captures added to the sync queue.
              </div>
            </div>
          )}

          {stage === 'error' && (
            <div className="py-4">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-bad mt-0.5 shrink-0" />
                <div>
                  <div className="text-[13px] font-semibold text-bad-fg">Couldn't parse CSV</div>
                  <div className="text-[12px] text-muted mt-1">{error}</div>
                </div>
              </div>
              <div className="mt-3">
                <Button variant="ghost" onClick={() => setStage('pick')}>Try again</Button>
              </div>
            </div>
          )}
        </div>

        {stage === 'preview' && diff && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 shrink-0">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={Check}
              onClick={confirm}
              disabled={diff.ops.length === 0}
            >
              {diff.ops.length === 0
                ? 'Nothing to import'
                : `Import ${diff.ops.length} cell${diff.ops.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function DiffStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'ok' | 'warn' | 'neutral'
}) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-ink'
  return (
    <div className="border border-gray-200 rounded-md px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={cn('font-mono font-bold text-[18px] tabular-nums mt-0.5', color)}>
        {value}
      </div>
    </div>
  )
}

// CSV parser tolerant to quoted fields with embedded commas, CRLF line endings,
// and escaped double-quotes (RFC-4180-ish). Returns array of rows.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        cur.push(field)
        field = ''
      } else if (ch === '\r') {
        // swallow; \n will close row
      } else if (ch === '\n') {
        cur.push(field)
        rows.push(cur)
        cur = []
        field = ''
      } else {
        field += ch
      }
    }
  }
  // Last field/row if no trailing newline
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''))
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, '').trim()
}

function computeDiff(
  text: string,
  assets: Asset[],
  fields: ClassificationField[],
  capByCell: Map<string, Capture>,
): ImportDiff {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('CSV is empty or has no data rows.')

  const header = rows[0]
  const headerKeys = header.map(normKey)

  // Locate mandatory columns
  const rowNumIdx = headerKeys.findIndex((h) => h === 'rownumber' || h === 'row')
  const assetIdIdx = headerKeys.findIndex((h) => h === 'assetid')
  if (assetIdIdx === -1 && rowNumIdx === -1) {
    throw new Error('CSV must have an "asset_id" or "row_number" column to match assets.')
  }

  // Map field columns by display_name (case/space-insensitive)
  const fieldByKey = new Map<string, ClassificationField>()
  for (const f of fields) fieldByKey.set(normKey(f.display_name), f)

  const skipCols = new Set(
    ['rownumber', 'row', 'assetid', 'description'].map(normKey),
  )
  const colToField = new Map<number, ClassificationField>()
  const unmatchedFieldsSet = new Set<string>()
  for (let c = 0; c < header.length; c++) {
    const key = headerKeys[c]
    if (skipCols.has(key)) continue
    const f = fieldByKey.get(key)
    if (f) colToField.set(c, f)
    else unmatchedFieldsSet.add(header[c])
  }

  // Index assets for lookup
  const assetById = new Map<string, Asset>()
  const assetByRowNum = new Map<string, Asset>()
  for (const a of assets) {
    if (a.asset_id) assetById.set(a.asset_id.trim(), a)
    assetByRowNum.set(String(a.row_number), a)
  }

  const diff: ImportDiff = {
    add: 0,
    overwrite: 0,
    unchanged: 0,
    skippedBlank: 0,
    unmatchedAssets: [],
    unmatchedFields: Array.from(unmatchedFieldsSet),
    ops: [],
  }

  const unmatchedAssetsSet = new Set<string>()

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const assetIdCell = assetIdIdx !== -1 ? (row[assetIdIdx] ?? '').trim() : ''
    const rowNumCell = rowNumIdx !== -1 ? (row[rowNumIdx] ?? '').trim() : ''
    const asset =
      (assetIdCell && assetById.get(assetIdCell)) ||
      (rowNumCell && assetByRowNum.get(rowNumCell)) ||
      null
    if (!asset) {
      if (assetIdCell || rowNumCell) unmatchedAssetsSet.add(assetIdCell || `row ${rowNumCell}`)
      continue
    }
    for (const [colIdx, field] of colToField.entries()) {
      const raw = (row[colIdx] ?? '').trim()
      if (raw === '') {
        diff.skippedBlank += 1
        continue
      }
      const existing = capByCell.get(`${asset.id}:${field.id}`)
      const prev = existing?.value ?? null
      if (prev === raw) {
        diff.unchanged += 1
        continue
      }
      if (prev == null || prev === '') {
        diff.add += 1
      } else {
        diff.overwrite += 1
      }
      diff.ops.push({
        assetId: asset.id,
        classificationFieldId: field.id,
        value: raw,
        prev,
      })
    }
  }

  diff.unmatchedAssets = Array.from(unmatchedAssetsSet)
  return diff
}
