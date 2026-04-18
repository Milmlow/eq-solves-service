import { useMemo } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Flag,
  MapPin,
  MoreHorizontal,
} from 'lucide-react'
import type { Asset, ClassificationField } from '../../types/db'
import { enqueueCapture, capturesForAsset } from '../../lib/queue'
import type { QueuedCapture } from '../../lib/queue'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Pill } from '../../components/ui/Pill'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { MetaRow } from '../../components/ui/MetaRow'
import { groupFields } from '../../lib/groupFields'
import { FieldEditor } from './FieldEditor'
import { PhotoPicker } from '../../components/PhotoPicker'

type Props = {
  jobId: string
  asset: Asset | null
  assets: Asset[]
  fields: ClassificationField[]
  capturerName: string | null
  onNavigateAsset: (assetId: string) => void
}

/**
 * Right-pane asset capture view: header strip, grouped field grid,
 * photos + site info sidebar, prev/next footer.
 */
export function AssetCapture({
  jobId,
  asset,
  assets,
  fields,
  capturerName,
  onNavigateAsset,
}: Props) {
  if (!asset) {
    return (
      <div className="flex-1 flex items-center justify-center p-10 text-[13px] text-muted">
        Select an asset to begin capture.
      </div>
    )
  }

  const captured = fields.filter((f) => f.is_field_captured)
  const classificationCode = asset.classification_code

  // Build a map of existing capture rows (local queue) for this asset.
  const localRows = capturesForAsset(asset.id)
  const byFieldId = new Map<number, QueuedCapture>()
  for (const c of localRows) byFieldId.set(c.classificationFieldId, c)

  const doneCount = captured.filter((f) => {
    const v = byFieldId.get(f.id)?.value
    return v && v.trim() !== ''
  }).length
  const totalReq = captured.length
  const flaggedCount = localRows.filter((c) => c.flagged).length

  // Prev / next asset (by row_number order as delivered)
  const idx = assets.findIndex((a) => a.id === asset.id)
  const prev = idx > 0 ? assets[idx - 1] : null
  const next = idx >= 0 && idx < assets.length - 1 ? assets[idx + 1] : null

  const groups = useMemo(
    () => groupFields(captured, classificationCode),
    [captured, classificationCode],
  )

  const setField = (
    fieldId: number,
    value: string | null,
    opts?: { flagged?: boolean; notes?: string | null },
  ) => {
    const existing = byFieldId.get(fieldId)
    enqueueCapture({
      jobId,
      assetId: asset.id,
      classificationFieldId: fieldId,
      value,
      capturedBy: capturerName,
      notes: opts?.notes ?? existing?.notes ?? null,
      flagged: opts?.flagged ?? existing?.flagged ?? false,
    })
  }

  const copyFromPrevious = () => {
    if (!prev) return
    const prevLocal = capturesForAsset(prev.id)
    for (const c of prevLocal) {
      if (!c.value || c.value.trim() === '') continue
      // Only copy if this asset doesn't already have a value for this field.
      const existing = byFieldId.get(c.classificationFieldId)
      if (existing?.value && existing.value.trim() !== '') continue
      enqueueCapture({
        jobId,
        assetId: asset.id,
        classificationFieldId: c.classificationFieldId,
        value: c.value,
        capturedBy: capturerName,
        notes: null,
        flagged: false,
      })
    }
  }

  const toggleAssetFlag = () => {
    // Asset-level flag = mark every field as flagged / unflagged.
    // If any field is flagged, clear them. Otherwise set flagged=true on all.
    const anyFlagged = flaggedCount > 0
    for (const f of captured) {
      const existing = byFieldId.get(f.id)
      enqueueCapture({
        jobId,
        assetId: asset.id,
        classificationFieldId: f.id,
        value: existing?.value ?? null,
        capturedBy: capturerName,
        notes: existing?.notes ?? null,
        flagged: !anyFlagged,
      })
    }
  }

  return (
    <div className="flex flex-col min-h-0 min-w-0">
      {/* ── Header strip ───────────────────────────────────────── */}
      <div className="px-5 py-3.5 border-b border-border bg-white">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <code className="text-[11px] font-bold font-mono text-sky-deep tracking-[0.04em]">
                #{asset.row_number.toString().padStart(3, '0')} · {asset.asset_id ?? asset.asset_uid ?? '—'}
              </code>
              <Pill
                tone={
                  totalReq === 0
                    ? 'neutral'
                    : doneCount === totalReq
                      ? 'ok'
                      : doneCount > 0
                        ? 'info'
                        : 'neutral'
                }
                size="sm"
              >
                {totalReq === 0
                  ? 'No fields'
                  : doneCount === totalReq
                    ? 'Complete'
                    : doneCount > 0
                      ? `${doneCount}/${totalReq} fields`
                      : 'Not started'}
              </Pill>
              {flaggedCount > 0 && (
                <Pill tone="bad" size="sm">
                  <Flag size={9} strokeWidth={2.5} />
                  {flaggedCount} flagged
                </Pill>
              )}
            </div>
            <div className="text-[18px] font-bold leading-tight tracking-[-0.01em] text-ink truncate">
              {asset.description}
            </div>
            <div className="text-[12px] text-muted mt-1 flex gap-4 flex-wrap items-center">
              {asset.location_description && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={11} strokeWidth={2} />
                  <span className="align-middle">{asset.location_description}</span>
                </span>
              )}
              {capturerName && (
                <span>
                  Captured by <b className="text-ink">{capturerName}</b>
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              icon={Flag}
              onClick={toggleAssetFlag}
              title={flaggedCount > 0 ? 'Clear all flags' : 'Flag this asset'}
            >
              {flaggedCount > 0 ? 'Unflag' : 'Flag'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Copy}
              onClick={copyFromPrevious}
              disabled={!prev}
              title={prev ? `Copy values from ${prev.asset_id ?? 'previous asset'}` : 'No previous asset'}
            >
              Copy prev
            </Button>
            <Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="More actions" />
          </div>
        </div>
        <div className="mt-3">
          <ProgressBar done={doneCount} total={totalReq} height={4} />
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 bg-gray-50">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
          {/* Left column: field groups */}
          <div className="flex flex-col gap-3.5 min-w-0">
            {groups.length === 0 && (
              <Card>
                <div className="text-[13px] text-muted text-center py-6">
                  No captureable fields defined for this classification.
                </div>
              </Card>
            )}
            {groups.map((g) => {
              const groupDone = g.fields.filter((f) => {
                const v = byFieldId.get(f.id)?.value
                return v && v.trim() !== ''
              }).length
              return (
                <Card key={g.title} padding={0}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
                    <div className="text-[12px] font-bold text-ink tracking-[-0.005em]">
                      {g.title}
                    </div>
                    <div className="text-[10px] font-mono text-muted tabular-nums">
                      {groupDone}/{g.fields.length}
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
                    {g.fields.map((f) => (
                      <FieldEditor
                        key={f.id}
                        field={f}
                        existing={byFieldId.get(f.id)}
                        onChange={(value, opts) => setField(f.id, value, opts)}
                      />
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Right column: photos + meta */}
          <div className="flex flex-col gap-3.5 min-w-0">
            <Card padding={0}>
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-100">
                <div className="text-[12px] font-bold text-ink">Photos</div>
              </div>
              <div className="p-3.5">
                <PhotoPicker assetId={asset.id} jobId={jobId} />
              </div>
            </Card>

            <Card padding={0}>
              <div className="px-3.5 py-2.5 border-b border-gray-100 text-[12px] font-bold text-ink">
                Site info
              </div>
              <div className="px-3.5 py-3 flex flex-col gap-0.5">
                {asset.manufacturer && (
                  <MetaRow label="Manufacturer">{asset.manufacturer}</MetaRow>
                )}
                {asset.model && (
                  <MetaRow label="Model" mono>
                    {asset.model}
                  </MetaRow>
                )}
                {asset.serial && (
                  <MetaRow label="Serial" mono>
                    {asset.serial}
                  </MetaRow>
                )}
                <MetaRow label="Row" mono>
                  #{asset.row_number}
                </MetaRow>
                <MetaRow label="Class" mono>
                  {asset.classification_code}
                </MetaRow>
                {asset.location_id && (
                  <MetaRow label="Location ID" mono>
                    {asset.location_id}
                  </MetaRow>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* ── Footer nav ─────────────────────────────────────────── */}
      <div className="px-5 py-2.5 border-t border-border bg-white flex items-center justify-between gap-3">
        <Button
          size="md"
          variant="ghost"
          icon={ArrowLeft}
          disabled={!prev}
          onClick={() => prev && onNavigateAsset(prev.id)}
        >
          {prev
            ? `#${prev.row_number.toString().padStart(3, '0')} ${prev.asset_id ?? ''}`.trim()
            : 'Previous'}
        </Button>
        <div className="text-[11px] text-muted tabular-nums">
          Row {asset.row_number} of {assets.length}
        </div>
        <Button
          size="md"
          variant="primary"
          iconRight={ArrowRight}
          disabled={!next}
          onClick={() => next && onNavigateAsset(next.id)}
        >
          {next
            ? `Save & next — ${next.asset_id ?? `#${next.row_number}`}`
            : 'Save & finish'}
        </Button>
      </div>
    </div>
  )
}
