import { useEffect, useMemo, useState } from 'react'
import { CheckSquare, ChevronDown, ClipboardPaste, Download, Flag, Grid3x3, Layers, MapPin, Search, Square, X } from 'lucide-react'
import type { Asset, ClassificationField } from '../../types/db'
import { allCaptures, enqueueBatch, subscribeQueue } from '../../lib/queue'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { ProgressRing } from '../../components/ui/ProgressRing'
import { cn } from '../../lib/cn'
import {
  clearFillTemplate,
  getFillTemplate,
  subscribeFillTemplate,
  type FillTemplate,
} from '../../lib/fillTemplate'

type Props = {
  jobId: string
  assets: Asset[]
  fields: ClassificationField[]
  activeAssetId: string | null
  capturerName: string | null
  onSelectAsset: (assetId: string) => void
  onOpenMatrix: () => void
  onOpenExport: () => void
  onOpenPasteBatch: () => void
}

type StatusFilter = 'all' | 'todo' | 'inprog' | 'done' | 'flagged'

/**
 * 360px-wide master pane: search + status chips + scrollable asset rows
 * + sticky footer with Matrix/Export buttons.
 */
export function AssetList({
  jobId,
  assets,
  fields,
  activeAssetId,
  capturerName,
  onSelectAsset,
  onOpenMatrix,
  onOpenExport,
  onOpenPasteBatch,
}: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [location, setLocation] = useState<string>('all')

  // Re-render on queue changes so the sync dot + progress stay fresh.
  const [, setTick] = useState(0)
  useEffect(() => subscribeQueue(() => setTick((t) => t + 1)), [])
  // Re-render when the fill template is set / cleared (per job).
  useEffect(() => subscribeFillTemplate(() => setTick((t) => t + 1)), [])

  // Multi-select mode (entered when user has set a fill template; bulk-fills
  // get scoped to the selected assets only).
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const template: FillTemplate | null = getFillTemplate(jobId)

  // When the template is cleared, exit selection mode and clear the set.
  useEffect(() => {
    if (!template) {
      setSelectionMode(false)
      setSelectedIds(new Set())
    }
  }, [template])

  const toggleSelected = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  const captureFieldIds = useMemo(
    () => new Set(fields.filter((f) => f.is_field_captured).map((f) => f.id)),
    [fields],
  )
  const totalRequired = captureFieldIds.size

  // Compute per-asset stats from the full capture queue in one pass.
  const stats = useMemo(() => {
    const byAsset = new Map<
      string,
      { done: number; flagged: boolean; hasPending: boolean; hasCaptures: boolean }
    >()
    for (const cap of allCaptures()) {
      if (!captureFieldIds.has(cap.classificationFieldId)) continue
      const s =
        byAsset.get(cap.assetId) ?? {
          done: 0,
          flagged: false,
          hasPending: false,
          hasCaptures: false,
        }
      s.hasCaptures = true
      if (cap.value && cap.value.trim() !== '') s.done += 1
      if (cap.flagged) s.flagged = true
      if (!cap.synced) s.hasPending = true
      byAsset.set(cap.assetId, s)
    }
    return byAsset
    // eslint-disable-next-line react-hooks/exhaustive-deps -- also depends on tick via state
  }, [captureFieldIds, assets])

  const rows = useMemo(() => {
    // Parent (JobScreenPage) already sorts in walking order.
    return assets.map((a) => {
      const s = stats.get(a.id) ?? {
        done: 0,
        flagged: false,
        hasPending: false,
        hasCaptures: false,
      }
      return {
        asset: a,
        done: s.done,
        total: totalRequired,
        flagged: s.flagged,
        sync:
          !s.hasCaptures
            ? ('none' as const)
            : s.hasPending
              ? ('pending' as const)
              : ('synced' as const),
      }
    })
  }, [assets, stats, totalRequired])

  // Distinct location list for the filter dropdown.
  const locations = useMemo(() => {
    const set = new Set<string>()
    for (const a of assets) {
      const v = a.location_description?.trim()
      if (v) set.add(v)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [assets])

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
    if (location !== 'all') {
      list = list.filter((r) => (r.asset.location_description ?? '') === location)
    }
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
  }, [rows, query, status, location])

  // ── Apply fill template to selected ─────────────────────────────────────
  // For each selected asset, write any template fields that the asset
  // doesn't already have a value for. Marks them flagged with a note
  // pointing at the source asset, so the tech reviews each one before
  // clearing the flag.
  const applyTemplate = () => {
    if (!template) return
    if (selectedIds.size === 0) return

    const captureFieldIdSet = new Set(fields.filter((f) => f.is_field_captured).map((f) => f.id))
    const existingByLocalId = new Map<string, string>()
    for (const c of allCaptures()) {
      if (c.value && c.value.trim() !== '') {
        existingByLocalId.set(`${c.assetId}:${c.classificationFieldId}`, c.value)
      }
    }

    const note = `Bulk-filled from ${template.sourceAssetLabel}`
    const batch: Array<{
      jobId: string
      assetId: string
      classificationFieldId: number
      value: string | null
      capturedBy: string | null
      notes?: string | null
      flagged?: boolean
    }> = []

    let touched = 0
    for (const aid of selectedIds) {
      // Skip assets in different classifications — template only makes
      // sense for the same field set.
      const a = assets.find((x) => x.id === aid)
      if (!a || a.classification_code !== template.classificationCode) continue

      for (const [fieldIdStr, value] of Object.entries(template.values)) {
        const fid = Number(fieldIdStr)
        if (!captureFieldIdSet.has(fid)) continue
        // Don't overwrite existing values — only fill empties
        if (existingByLocalId.has(`${aid}:${fid}`)) continue
        batch.push({
          jobId,
          assetId: aid,
          classificationFieldId: fid,
          value,
          capturedBy: capturerName,
          notes: note,
          flagged: true,
        })
        touched += 1
      }
    }

    if (batch.length > 0) {
      enqueueBatch(batch)
    }

    // Quick visual feedback: leave selection mode, surface the flagged filter
    setSelectionMode(false)
    setSelectedIds(new Set())
    setStatus('flagged')

    // Lightweight confirmation; alert is fine here since we want the tech to
    // see the count before they walk off.
    const skipped = selectedIds.size - new Set(batch.map((b) => b.assetId)).size
    const msg =
      `Filled ${touched} field${touched === 1 ? '' : 's'} across ` +
      `${new Set(batch.map((b) => b.assetId)).size} asset${batch.length === 1 ? '' : 's'}.` +
      (skipped > 0 ? `  (${skipped} skipped — different classification.)` : '') +
      `  All marked flagged for review.`
    if (typeof window !== 'undefined') window.alert(msg)
  }

  return (
    <div className="flex flex-col min-h-0 border-r border-border">
      {/* Fill-template banner — only when a template is set */}
      {template && (
        <div className="px-3.5 py-2 bg-warn-bg border-b border-warn/40 flex items-center gap-2">
          <Layers size={13} strokeWidth={2.5} className="text-warn shrink-0" />
          <div className="flex-1 min-w-0 text-[11px] leading-tight">
            <div className="font-bold text-warn-fg truncate">
              Template: <span className="font-mono">{template.sourceAssetLabel}</span>
            </div>
            <div className="text-warn-fg/80">
              {Object.keys(template.values).length} field
              {Object.keys(template.values).length === 1 ? '' : 's'} ready to apply
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectionMode((s) => !s)}
            className={cn(
              'px-2 py-1 rounded-md border text-[10px] font-bold uppercase tracking-[0.04em]',
              'transition-colors duration-120 cursor-pointer shrink-0',
              selectionMode
                ? 'border-warn bg-warn text-white'
                : 'border-warn/40 bg-white text-warn-fg hover:border-warn',
            )}
          >
            {selectionMode ? 'Cancel' : 'Pick assets'}
          </button>
          <button
            type="button"
            onClick={() => clearFillTemplate(jobId)}
            title="Clear template"
            className="text-warn-fg hover:text-warn cursor-pointer p-0.5 shrink-0"
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}

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
        {locations.length > 0 && (
          <div className="relative mt-2">
            <MapPin
              size={13}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={cn(
                'w-full pl-7 pr-7 py-[7px] rounded-md border border-border bg-white',
                'text-[12px] font-sans outline-none appearance-none cursor-pointer',
                'focus:border-sky-deep focus:shadow-focus',
                location === 'all' ? 'text-muted' : 'text-ink',
              )}
            >
              <option value="all">All locations ({locations.length})</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              strokeWidth={2}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
          </div>
        )}
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
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
            sync={r.sync}
            active={r.asset.id === activeAssetId}
            selectionMode={selectionMode}
            selected={selectedIds.has(r.asset.id)}
            templateClass={template?.classificationCode ?? null}
            onClick={() => {
              if (selectionMode) {
                toggleSelected(r.asset.id)
              } else {
                onSelectAsset(r.asset.id)
              }
            }}
          />
        ))}
      </div>

      {/* Sticky apply bar — only when picking assets */}
      {selectionMode && template && (
        <div className="px-3 py-2.5 border-t border-warn/40 bg-warn-bg flex items-center gap-2">
          <div className="flex-1 text-[11px] font-bold text-warn-fg">
            {selectedIds.size} selected
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={applyTemplate}
            disabled={selectedIds.size === 0}
          >
            Apply to {selectedIds.size}
          </Button>
        </div>
      )}

      {/* Sticky footer */}
      <div className="p-3 border-t border-gray-100 bg-gray-50">
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" icon={Grid3x3} onClick={onOpenMatrix} fullWidth>
            Matrix
          </Button>
          <Button size="sm" variant="ghost" icon={ClipboardPaste} onClick={onOpenPasteBatch} fullWidth>
            Paste
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
        'px-2.5 py-1.5 rounded-full border text-[11px] font-bold uppercase tracking-[0.04em]',
        'min-h-[28px] transition-colors duration-120 cursor-pointer',
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
  sync,
  active,
  selectionMode,
  selected,
  templateClass,
  onClick,
}: {
  asset: Asset
  done: number
  total: number
  flagged: boolean
  sync: 'none' | 'pending' | 'synced'
  active: boolean
  selectionMode: boolean
  selected: boolean
  templateClass: string | null
  onClick: () => void
}) {
  const complete = total > 0 && done === total
  const started = done > 0 && !complete
  // Asset is eligible for the active template only if classification matches
  const eligible = !templateClass || asset.classification_code === templateClass

  const syncTitle =
    sync === 'synced'
      ? 'All captures on this asset are synced'
      : sync === 'pending'
        ? 'Some captures are still queued for sync'
        : 'No captures yet'
  const syncClass =
    sync === 'synced'
      ? 'bg-ok'
      : sync === 'pending'
        ? 'bg-warn animate-pulse'
        : 'bg-gray-300'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={selectionMode && !eligible}
      className={cn(
        'w-full text-left flex items-center gap-2.5 border-b border-gray-100',
        'transition-colors duration-120',
        'py-3 pr-3.5',
        active && !selectionMode
          ? 'bg-ice border-l-[3px] border-l-sky pl-[11px] cursor-pointer'
          : selectionMode && selected
            ? 'bg-warn-bg border-l-[3px] border-l-warn pl-[11px] cursor-pointer'
            : selectionMode && !eligible
              ? 'bg-gray-50 opacity-50 border-l-[3px] border-l-transparent pl-[11px] cursor-not-allowed'
              : 'bg-white border-l-[3px] border-l-transparent pl-[11px] hover:bg-gray-50 cursor-pointer',
      )}
    >
      {selectionMode ? (
        selected ? (
          <CheckSquare size={20} strokeWidth={2.5} className="text-warn shrink-0" />
        ) : (
          <Square size={20} strokeWidth={2} className="text-gray-300 shrink-0" />
        )
      ) : (
        <ProgressRing done={done} total={total} size={30} stroke={3} showLabel={false} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            title={syncTitle}
            aria-label={syncTitle}
            className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', syncClass)}
          />
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
