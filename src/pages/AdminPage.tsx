import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Flag, RefreshCw } from 'lucide-react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { supabase } from '../lib/supabase'
import { allCaptures, subscribeQueue } from '../lib/queue'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ProgressBar } from '../components/ui/ProgressBar'
import { cn } from '../lib/cn'

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
          <Button size="sm" variant="ghost" icon={Download} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

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
