import { useMemo, useState } from 'react'
import { Download, Flag, Grid3x3, Search } from 'lucide-react'
import type { Asset, ClassificationField } from '../../types/db'
import { allCaptures } from '../../lib/queue'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { ProgressRing } from '../../components/ui/ProgressRing'
import { cn } from '../../lib/cn'

type Props = {
  assets: Asset[]
  fields: ClassificationField[]
  activeAssetId: string | null
  onSelectAsset: (assetId: string) => void
  onOpenMatrix: () => void
  onOpenExport: () => void
}

type StatusFilter = 'all' | 'todo' | 'inprog' | 'done' | 'flagged'

/**
 * 360px-wide master pane: search + status chips + scrollable asset rows
 * + sticky footer with Matrix/Export buttons.
 */
export function AssetList({
  assets,
  fields,
  activeAssetId,
  onSelectAsset,
  onOpenMatrix,
  onOpenExport,
}: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const captureFieldIds = useMemo(
    () => new Set(fields.filter((f) => f.is_field_captured).map((f) => f.id)),
    [fields],
  )
  const totalRequired = captureFieldIds.size

  // Compute per-asset stats from the full capture queue in one pass.
  const stats = useMemo(() => {
    const byAsset = new Map<string, { done: number; flagged: boolean }>()
    for (const cap of allCaptures()) {
      if (!captureFieldIds.has(cap.classificationFieldId)) continue
      const s = byAsset.get(cap.assetId) ?? { done: 0, flagged: false }
      if (cap.value && cap.value.trim() !== '') s.done += 1
      if (cap.flagged) s.flagged = true
      byAsset.set(cap.assetId, s)
    }
    return byAsset
  }, [captureFieldIds, assets])

  const rows = useMemo(() => {
    return assets.map((a) => {
      const s = stats.get(a.id) ?? { done: 0, flagged: false }
      return { asset: a, done: s.done, total: totalRequired, flagged: s.flagged }
    })
  }, [assets, stats, totalRequired])

  const counts = useMemo(() => {
    let todo = 0,
      inprog = 0,
      done = 0,
      flagged = 0
    for (const r of rows) {
      if (r.done === 0) todo += 1
      else if (r.done < r.total) inprog += 1
      else if (r.total > 0 && r.done === r.total) done += 1
      if (r.flagged) flagged += 1
    }
    return { all: rows.length, todo, inprog, done, flagged }
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((r) => {
        const a = r.asset
        return [a.asset_id ?? '', a.description, a.location_description ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
    }
    if (status !== 'all') {
      list = list.filter((r) => {
        if (status === 'todo') return r.done === 0
        if (status === 'inprog') return r.done > 0 && r.done < r.total
        if (status === 'done') return r.total > 0 && r.done === r.total
        if (status === 'flagged') return r.flagged
        return true
      })
    }
    return list
  }, [rows, query, status])

  return (
    <div className="flex flex-col min-h-0 border-r border-border">
      {/* Header + filters */}
      <div className="p-3.5 pb-2.5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[13px] font-bold text-ink">Assets</div>
          <div className="text-[11px] font-mono text-muted tabular-nums">
            {filtered.length} of {rows.length}
          </div>
        </div>
        <Input
          value={query}
          onChange={setQuery}
          placeholder="Find by ID, description, location…"
          icon={Search}
        />
        <div className="flex gap-1 mt-2.5 flex-wrap">
          <FilterChip active={status === 'all'} onClick={() => setStatus('all')} count={counts.all}>
            All
          </FilterChip>
          <FilterChip active={status === 'todo'} onClick={() => setStatus('todo')} count={counts.todo}>
            To do
          </FilterChip>
          <FilterChip
            active={status === 'inprog'}
            onClick={() => setStatus('inprog')}
            count={counts.inprog}
          >
            In prog
          </FilterChip>
          <FilterChip active={status === 'done'} onClick={() => setStatus('done')} count={counts.done}>
            Done
          </FilterChip>
          <FilterChip
            active={status === 'flagged'}
            onClick={() => setStatus('flagged')}
            count={counts.flagged}
          >
            Flagged
          </FilterChip>
        </div>
      </div>

      {/* Scrollable row list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-10 text-center text-[12px] text-muted">
            {rows.length === 0 ? 'No assets in this job yet.' : 'No assets match those filters.'}
          </div>
        )}
        {filtered.map((r) => (
          <AssetRow
            key={r.asset.id}
            asset={r.asset}
            done={r.done}
            total={r.total}
            flagged={r.flagged}
            active={r.asset.id === activeAssetId}
            onClick={() => onSelectAsset(r.asset.id)}
          />
        ))}
      </div>

      {/* Sticky footer */}
      <div className="p-3 border-t border-gray-100 bg-gray-50">
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" icon={Grid3x3} onClick={onOpenMatrix} fullWidth>
            Matrix
          </Button>
          <Button size="sm" variant="ghost" icon={Download} onClick={onOpenExport} fullWidth>
            Export
          </Button>
        </div>
      </div>
    </div>
  )
}

function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean
  count: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-full border text-[10px] font-bold uppercase tracking-[0.04em]',
        'transition-colors duration-120 cursor-pointer',
        active
          ? 'border-sky-deep bg-ice text-sky-deep'
          : 'border-border bg-white text-muted hover:border-sky-deep/60 hover:text-ink',
      )}
    >
      {children} <span className="opacity-70 ml-0.5">{count}</span>
    </button>
  )
}

function AssetRow({
  asset,
  done,
  total,
  flagged,
  active,
  onClick,
}: {
  asset: Asset
  done: number
  total: number
  flagged: boolean
  active: boolean
  onClick: () => void
}) {
  const complete = total > 0 && done === total
  const started = done > 0 && !complete

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-2.5 border-b border-gray-100',
        'transition-colors duration-120 cursor-pointer',
        'py-3 pr-3.5',
        active
          ? 'bg-ice border-l-[3px] border-l-sky pl-[11px]'
          : 'bg-white border-l-[3px] border-l-transparent pl-[11px] hover:bg-gray-50',
      )}
    >
      <ProgressRing done={done} total={total} size={30} stroke={3} showLabel={false} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-[12px] font-bold font-mono text-ink truncate">
            #{asset.row_number.toString().padStart(3, '0')} · {asset.asset_id ?? asset.asset_uid ?? '—'}
          </div>
          {flagged && <Flag size={11} strokeWidth={2.5} className="text-bad shrink-0" />}
        </div>
        <div className="text-[12px] text-gray-600 truncate mt-0.5">{asset.description}</div>
        {asset.location_description && (
          <div className="text-[10px] text-gray-400 uppercase tracking-[0.04em] mt-0.5 truncate">
            {asset.location_description}
          </div>
        )}
      </div>
      <div
        className={cn(
          'text-[10px] font-bold font-mono shrink-0 tabular-nums',
          complete ? 'text-ok' : started ? 'text-sky-deep' : 'text-gray-400',
        )}
      >
        {complete ? '✓' : `${done}/${total}`}
      </div>
    </button>
  )
}
