import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { TopBar } from '../components/TopBar'
import { ShareDialog } from '../components/ShareDialog'
import { supabase } from '../lib/supabase'

interface Capture {
  asset_id: string
  classification_field_id: number
  value: string | null
  captured_by: string | null
  captured_at: string
  flagged: boolean
  notes: string | null
}

export function AdminPage({ jobRef }: { jobRef: string }) {
  const { job } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  const fieldsCaptured = useMemo(() => fields.filter((f) => f.is_field_captured), [fields])

  const load = async () => {
    if (!assets.length) return
    setLoading(true)
    const { data, error } = await supabase
      .from('captures')
      .select('asset_id, classification_field_id, value, captured_by, captured_at, flagged, notes')
      .in('asset_id', assets.map((a) => a.id))
    if (!error && data) setCaptures(data as Capture[])
    setLoading(false)
    setLastFetch(new Date())
  }

  useEffect(() => {
    void load()
  }, [assets.length])

  // Poll every 15s when tab is focused
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    return () => clearInterval(id)
  }, [assets.length])

  // Index captures by (assetId, fieldId)
  const capByCell = useMemo(() => {
    const m = new Map<string, Capture>()
    for (const c of captures) m.set(`${c.asset_id}:${c.classification_field_id}`, c)
    return m
  }, [captures])

  // Per-asset progress
  const progressByAsset = useMemo(() => {
    const m = new Map<string, { done: number; total: number; byWhom: Set<string>; latest: string | null }>()
    for (const a of assets) {
      let done = 0
      let latest: string | null = null
      const byWhom = new Set<string>()
      for (const f of fieldsCaptured) {
        const c = capByCell.get(`${a.id}:${f.id}`)
        if (c?.value && c.value !== '') {
          done++
          if (c.captured_by) byWhom.add(c.captured_by)
          if (!latest || c.captured_at > latest) latest = c.captured_at
        }
      }
      m.set(a.id, { done, total: fieldsCaptured.length, byWhom, latest })
    }
    return m
  }, [assets, fieldsCaptured, capByCell])

  const totalDone = useMemo(
    () => [...progressByAsset.values()].filter((p) => p.done === p.total && p.total > 0).length,
    [progressByAsset],
  )
  const totalCells = assets.length * fieldsCaptured.length
  const filledCells = useMemo(() => {
    let n = 0
    for (const p of progressByAsset.values()) n += p.done
    return n
  }, [progressByAsset])

  // Who captured what — breakdown by person
  const byPerson = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of captures) {
      if (!c.value || !c.captured_by) continue
      m.set(c.captured_by, (m.get(c.captured_by) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [captures])

  const flagged = useMemo(() => captures.filter((c) => c.flagged), [captures])

  return (
    <div className="min-h-screen flex flex-col bg-sky-soft">
      <TopBar
        title={job?.name ?? 'Admin'}
        subtitle={job ? `${job.site_code} · ${job.classification_code} · admin view` : undefined}
        onBack={() => navigate(`/j/${jobRef}`)}
        right={
          <div className="flex gap-2 ml-2">
            <button onClick={() => setShareOpen(true)} className="btn btn-ghost btn-md">
              Share
            </button>
            <button onClick={load} className="btn btn-ghost btn-md">
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
        }
      />

      <div className="px-6 py-6 space-y-4 flex-1">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Assets complete" value={`${totalDone}/${assets.length}`} accent="sky" />
          <Kpi
            label="Data points filled"
            value={`${filledCells}/${totalCells}`}
            accent="ok"
            sub={totalCells ? `${Math.round((filledCells / totalCells) * 100)}%` : '—'}
          />
          <Kpi label="Captured by" value={`${byPerson.length}`} sub="field techs" />
          <Kpi
            label="Flagged"
            value={`${flagged.length}`}
            accent={flagged.length ? 'warn' : undefined}
            sub="review required"
          />
        </div>

        {/* Per-person breakdown */}
        {byPerson.length > 0 ? (
          <div className="card p-4">
            <h2 className="font-bold text-ink mb-2 text-sm">Captures by person</h2>
            <div className="flex flex-wrap gap-2">
              {byPerson.map(([name, n]) => (
                <div
                  key={name}
                  className="px-3 py-1.5 rounded-full bg-sky-soft border border-border text-sm"
                >
                  <span className="font-semibold">{name}</span>
                  <span className="text-muted ml-1.5">{n}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Flagged list */}
        {flagged.length > 0 ? (
          <div className="card p-4 border-warn/40 bg-warn/5">
            <h2 className="font-bold text-ink mb-2 text-sm">Flagged for review</h2>
            <div className="space-y-2 text-sm">
              {flagged.slice(0, 10).map((c) => {
                const asset = assets.find((a) => a.id === c.asset_id)
                const field = fields.find((f) => f.id === c.classification_field_id)
                return (
                  <div key={`${c.asset_id}:${c.classification_field_id}`} className="flex items-start gap-2">
                    <span className="text-warn">⚑</span>
                    <div className="flex-1">
                      <div className="font-semibold">
                        {asset?.description ?? '?'} · {field?.display_name ?? '?'}
                      </div>
                      {c.notes ? <div className="text-xs text-muted">{c.notes}</div> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* Asset grid */}
        <div className="card p-0 overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h2 className="font-bold text-ink text-sm">Asset matrix</h2>
            <div className="text-xs text-muted">
              {lastFetch ? `Updated ${formatRelative(lastFetch)}` : 'Loading…'} · auto-refreshes every 15s
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-sky-soft/60 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-sky-soft z-10 min-w-[240px]">
                    Asset
                  </th>
                  <th className="text-left px-3 py-2 font-semibold min-w-[100px]">Progress</th>
                  <th className="text-left px-3 py-2 font-semibold min-w-[110px]">Captured by</th>
                  <th className="text-left px-3 py-2 font-semibold min-w-[110px]">Last update</th>
                  {fieldsCaptured.map((f) => (
                    <th
                      key={f.id}
                      className="text-center px-1.5 py-2 font-semibold min-w-[28px]"
                      title={f.display_name}
                    >
                      <div className="rotate-[-60deg] origin-left whitespace-nowrap h-12 translate-y-3 translate-x-3 text-[10px] font-semibold text-muted">
                        {f.display_name.length > 22
                          ? f.display_name.slice(0, 22) + '…'
                          : f.display_name}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {assets.map((a) => {
                  const p = progressByAsset.get(a.id)!
                  const complete = p.done === p.total && p.total > 0
                  return (
                    <tr key={a.id} className="hover:bg-sky-soft/40">
                      <td className="px-3 py-2 sticky left-0 bg-white/80 backdrop-blur z-[1] font-semibold text-ink">
                        <button
                          onClick={() => navigate(`/j/${jobRef}/a/${a.id}`)}
                          className="text-left hover:text-sky-deep"
                        >
                          <div className="mono text-[10px] text-muted">#{a.asset_id ?? '—'}</div>
                          <div className="leading-tight">{a.description}</div>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-border/60 overflow-hidden">
                            <div
                              className={`h-full ${complete ? 'bg-ok' : 'bg-sky'}`}
                              style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }}
                            />
                          </div>
                          <span className="mono text-[10px] tabular-nums">
                            {p.done}/{p.total}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {[...p.byWhom].join(', ') || <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {p.latest ? formatRelative(new Date(p.latest)) : '—'}
                      </td>
                      {fieldsCaptured.map((f) => {
                        const c = capByCell.get(`${a.id}:${f.id}`)
                        const has = Boolean(c?.value && c.value !== '')
                        return (
                          <td key={f.id} className="text-center px-1 py-1">
                            <span
                              title={
                                c?.value
                                  ? `${f.display_name}: ${c.value}${c.captured_by ? ' (' + c.captured_by + ')' : ''}`
                                  : `${f.display_name}: empty`
                              }
                              className={`inline-block w-4 h-4 rounded ${
                                has
                                  ? c?.flagged
                                    ? 'bg-warn'
                                    : 'bg-ok'
                                  : 'bg-border/60'
                              }`}
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
        </div>
      </div>

      {shareOpen && job ? (
        <ShareDialog
          url={`${window.location.origin}/#/j/${job.slug ?? job.id}`}
          title={job.name ?? `${job.site_code} ${job.classification_code}`}
          subtitle="Scan to open the capture form on a phone"
          pin={null}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'sky' | 'ok' | 'warn'
}) {
  const accentClass =
    accent === 'ok'
      ? 'text-ok'
      : accent === 'warn'
        ? 'text-warn'
        : accent === 'sky'
          ? 'text-sky-deep'
          : 'text-ink'
  return (
    <div className="card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-2xl font-bold ${accentClass}`}>{value}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
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
