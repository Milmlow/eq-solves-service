import { useMemo, useState, useEffect } from 'react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob, usePendingForJob } from '../hooks/useJobData'
import { TopBar } from '../components/TopBar'
import { ProgressRing } from '../components/ProgressRing'
import { ShareDialog } from '../components/ShareDialog'
import { SiteInfoSheet } from '../components/SiteInfoSheet'
import { allCaptures, subscribeQueue } from '../lib/queue'
import type { Asset } from '../types/db'

export function JobPage({ jobRef }: { jobRef: string }) {
  const { job, loading: jobLoading, error } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets, loading: assetsLoading } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'complete'>('all')
  const [shareOpen, setShareOpen] = useState(false)
  const [siteInfoOpen, setSiteInfoOpen] = useState(false)

  // Force re-render when queue changes so progress counts update live
  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick((v) => v + 1)), [])

  const requiredFieldIds = useMemo(
    () => new Set(fields.filter((f) => f.is_field_captured).map((f) => f.id)),
    [fields],
  )
  const requiredCount = requiredFieldIds.size

  // Map assetId → done count (based on local queue + anything that's synced)
  const doneByAsset = useMemo(() => {
    const m = new Map<string, number>()
    const all = allCaptures()
    for (const c of all) {
      if (!c.value || c.value === '') continue
      if (!requiredFieldIds.has(c.classificationFieldId)) continue
      m.set(c.assetId, (m.get(c.assetId) ?? 0) + 1)
    }
    return m
  }, [requiredFieldIds, assets])

  const pendingInJob = usePendingForJob(jobId, assets.map((a) => a.id))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter((a) => {
      const done = doneByAsset.get(a.id) ?? 0
      if (filter === 'incomplete' && done >= requiredCount && requiredCount > 0) return false
      if (filter === 'complete' && (done < requiredCount || requiredCount === 0)) return false
      if (!q) return true
      return (
        a.description.toLowerCase().includes(q) ||
        (a.asset_id ?? '').toLowerCase().includes(q) ||
        (a.location_description ?? '').toLowerCase().includes(q)
      )
    })
  }, [assets, doneByAsset, filter, query, requiredCount])

  const totalDone = useMemo(() => {
    let n = 0
    for (const a of assets) if ((doneByAsset.get(a.id) ?? 0) >= requiredCount && requiredCount > 0) n++
    return n
  }, [assets, doneByAsset, requiredCount])

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <div className="text-bad font-bold mb-2">Can't open this job</div>
        <div className="text-sm text-muted mb-4">{error}</div>
        <button onClick={() => navigate('/')} className="btn btn-ghost btn-md">Back</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        title={job?.name ?? 'Loading…'}
        subtitle={job ? `${job.site_code} · ${job.classification_code}` : undefined}
        onBack={() => navigate('/')}
      />

      <div className="px-4 pt-4 pb-2 space-y-3">
        {/* Site info pinned at top */}
        {job?.site_code ? (
          <button
            onClick={() => setSiteInfoOpen(true)}
            className="card p-3 flex items-center gap-3 w-full text-left hover:border-sky/50 active:scale-[0.99] transition"
          >
            <div className="w-9 h-9 rounded-lg bg-sky-soft flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-deep">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ink leading-tight">Site info</div>
              <div className="text-xs text-muted">Layout drawing, contacts, notes</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ) : null}

        {/* Job-level progress card */}
        <div className="card p-4 flex items-center gap-4">
          <ProgressRing done={totalDone} total={assets.length} size={56} />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-ink leading-tight">
              {totalDone} of {assets.length} assets complete
            </div>
            <div className="text-xs text-muted">
              {requiredCount} field{requiredCount === 1 ? '' : 's'} to capture per asset
              {pendingInJob > 0 ? ` · ${pendingInJob} pending sync` : ''}
            </div>
          </div>
          <button
            onClick={() => setShareOpen(true)}
            className="btn btn-ghost btn-md whitespace-nowrap"
            title="Share link + QR code"
          >
            Share
          </button>
          <button
            onClick={() => navigate(`/j/${jobRef}/export`)}
            className="btn btn-ghost btn-md whitespace-nowrap"
          >
            Export
          </button>
        </div>

        {/* Search */}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by asset ID or description…"
          className="field-input"
        />

        {/* Filter chips */}
        <div className="flex gap-2 text-sm">
          {[
            { key: 'all', label: `All · ${assets.length}` },
            { key: 'incomplete', label: `To do · ${assets.length - totalDone}` },
            { key: 'complete', label: `Done · ${totalDone}` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`px-3 py-2 rounded-lg font-semibold border ${
                filter === key
                  ? 'bg-sky text-white border-sky'
                  : 'bg-white text-ink border-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Asset list */}
      <div className="flex-1 px-4 pb-6 safe-bottom">
        {assetsLoading && !assets.length ? (
          <div className="text-center text-muted py-12">Loading assets…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted py-12 text-sm">No matching assets</div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((a) => (
              <AssetRow
                key={a.id}
                asset={a}
                done={doneByAsset.get(a.id) ?? 0}
                total={requiredCount}
                onClick={() => navigate(`/j/${jobRef}/a/${a.id}`)}
              />
            ))}
          </ul>
        )}
      </div>

      {shareOpen && job ? (
        <ShareDialog
          url={`${window.location.origin}/#/j/${job.slug ?? job.id}`}
          title={job.name ?? `${job.site_code} ${job.classification_code}`}
          subtitle="Scan the QR code or copy the link to share with the field tech"
          pin={null /* we never surface the PIN from the UI — set out-of-band */}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      {siteInfoOpen && job?.site_code ? (
        <SiteInfoSheet siteCode={job.site_code} onClose={() => setSiteInfoOpen(false)} />
      ) : null}
    </div>
  )
}

function AssetRow({
  asset,
  done,
  total,
  onClick,
}: {
  asset: Asset
  done: number
  total: number
  onClick: () => void
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="card w-full p-4 text-left flex items-center gap-4 hover:border-sky/50 transition"
      >
        <ProgressRing done={done} total={total} size={44} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted mono">#{asset.asset_id ?? '—'}</div>
          <div className="font-semibold text-ink truncate">{asset.description}</div>
          {asset.location_description ? (
            <div className="text-xs text-muted truncate">{asset.location_description}</div>
          ) : null}
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </li>
  )
}
