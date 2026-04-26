import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ClipboardPaste, X } from 'lucide-react'
import type { Asset, ClassificationField } from '../types/db'
import { allCaptures, enqueueBatch } from '../lib/queue'
import { Button } from './ui/Button'
import { cn } from '../lib/cn'

// ============================================================================
// Paste-batch import
//
// The tech pastes a TSV block (Excel selection, Google Sheets, etc.). We
// auto-detect the header row and try to map each column to a captured field
// or an asset key (Asset ID, Description). The tech reviews the mapping +
// preview of the first 5 rows, then hits Apply. Every value lands in the
// queue as a flagged capture so the office can review the lineage.
// ============================================================================

type Props = {
  jobId: string
  assets: Asset[]
  fields: ClassificationField[]
  capturerName: string | null
  onClose: () => void
}

type ColumnMapping =
  | { kind: 'ignore' }
  | { kind: 'asset_id' }
  | { kind: 'description' }
  | { kind: 'field'; fieldId: number }

interface ParsedRow {
  cells: string[]
  matchedAssetId: string | null
  matchReason: 'asset_id' | 'description' | null
}

const MAPPING_KEYS = ['asset_id', 'description'] as const

export function PasteBatchModal({ jobId, assets, fields, capturerName, onClose }: Props) {
  const [pasted, setPasted] = useState('')
  const [hasHeader, setHasHeader] = useState(true)

  // Capturable fields, keyed by id, used for the dropdowns + writing
  const captureFields = useMemo(
    () => fields.filter((f) => f.is_field_captured),
    [fields],
  )

  // Parse the pasted block into rows of cells (TSV first, fall back to CSV)
  const parsed = useMemo(() => parseBlock(pasted), [pasted])

  // Auto-detect column mapping from the header row
  const [mapping, setMapping] = useState<ColumnMapping[]>([])
  useEffect(() => {
    if (!parsed || parsed.length === 0) {
      setMapping([])
      return
    }
    const header = hasHeader ? parsed[0] : null
    setMapping(autodetectMapping(header, parsed[0].length, captureFields))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.length, hasHeader, parsed?.[0]?.join('|'), captureFields.length])

  // Match data rows to assets by asset_id or description
  const rowsForApply: ParsedRow[] = useMemo(() => {
    if (!parsed || parsed.length === 0) return []
    const dataStart = hasHeader ? 1 : 0
    const aidColIdx = mapping.findIndex((m) => m.kind === 'asset_id')
    const descColIdx = mapping.findIndex((m) => m.kind === 'description')

    // Index assets for fast lookup
    const byAssetId = new Map<string, string>() // asset_id -> internal id
    const byDesc = new Map<string, string>()
    for (const a of assets) {
      if (a.asset_id) byAssetId.set(a.asset_id.trim().toUpperCase(), a.id)
      if (a.description) byDesc.set(a.description.trim().toUpperCase(), a.id)
    }

    return parsed.slice(dataStart).map((cells) => {
      let matchedAssetId: string | null = null
      let matchReason: ParsedRow['matchReason'] = null

      if (aidColIdx >= 0) {
        const v = (cells[aidColIdx] ?? '').trim().toUpperCase()
        const m = byAssetId.get(v)
        if (m) {
          matchedAssetId = m
          matchReason = 'asset_id'
        }
      }
      if (!matchedAssetId && descColIdx >= 0) {
        const v = (cells[descColIdx] ?? '').trim().toUpperCase()
        const m = byDesc.get(v)
        if (m) {
          matchedAssetId = m
          matchReason = 'description'
        }
      }
      return { cells, matchedAssetId, matchReason }
    })
  }, [parsed, hasHeader, mapping, assets])

  const matchedCount = rowsForApply.filter((r) => r.matchedAssetId).length
  const fieldCols = mapping.filter((m) => m.kind === 'field').length

  // Plan = how many actual writes we'll make
  const planValueCount = useMemo(() => {
    let n = 0
    for (const r of rowsForApply) {
      if (!r.matchedAssetId) continue
      for (let i = 0; i < mapping.length; i++) {
        const m = mapping[i]
        if (m.kind !== 'field') continue
        const v = (r.cells[i] ?? '').trim()
        if (v) n++
      }
    }
    return n
  }, [rowsForApply, mapping])

  const apply = () => {
    if (planValueCount === 0) return

    // Build batch — only fill empties (don't overwrite existing captured values)
    const existingByLocalId = new Set<string>()
    for (const c of allCaptures()) {
      if (c.value && c.value.trim() !== '') {
        existingByLocalId.add(`${c.assetId}:${c.classificationFieldId}`)
      }
    }

    const note = 'Bulk-filled via paste-import'
    const batch: Array<{
      jobId: string
      assetId: string
      classificationFieldId: number
      value: string | null
      capturedBy: string | null
      notes?: string | null
      flagged?: boolean
    }> = []

    for (const r of rowsForApply) {
      if (!r.matchedAssetId) continue
      for (let i = 0; i < mapping.length; i++) {
        const m = mapping[i]
        if (m.kind !== 'field') continue
        const v = (r.cells[i] ?? '').trim()
        if (!v) continue
        const localId = `${r.matchedAssetId}:${m.fieldId}`
        if (existingByLocalId.has(localId)) continue
        batch.push({
          jobId,
          assetId: r.matchedAssetId,
          classificationFieldId: m.fieldId,
          value: v,
          capturedBy: capturerName,
          notes: note,
          flagged: true,
        })
      }
    }

    if (batch.length > 0) enqueueBatch(batch)
    if (typeof window !== 'undefined') {
      const skipped = planValueCount - batch.length
      window.alert(
        `Imported ${batch.length} value${batch.length === 1 ? '' : 's'} as flagged captures.` +
          (skipped > 0 ? `  (${skipped} skipped — already captured.)` : ''),
      )
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl border border-border w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <ClipboardPaste size={16} strokeWidth={2.5} className="text-sky-deep" />
            <h2 className="text-[15px] font-bold tracking-[-0.01em]">Paste from Excel</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink cursor-pointer p-1"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Step 1 — paste */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted mb-1.5">
              1. Paste rows
            </div>
            <p className="text-[12px] text-muted mb-2">
              Copy a selection from Excel, Google Sheets, or any TSV/CSV. Include a header row
              with column names — we'll match them to fields automatically.
            </p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder={
                'Asset ID\tAmp Frame\tkA Rating\tVoltage Rating\n' +
                '1076\t4000\t65\t690\n' +
                '1077\t2000\t65\t690'
              }
              className={cn(
                'w-full px-3 py-2 rounded-md border border-gray-300',
                'text-[12px] font-mono outline-none resize-y bg-white',
                'focus:border-sky-deep focus:shadow-focus',
              )}
            />
            <label className="mt-2 inline-flex items-center gap-2 text-[12px] text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="cursor-pointer"
              />
              First row is a header (column names)
            </label>
          </section>

          {/* Step 2 — mapping */}
          {parsed && parsed.length > 0 && (
            <section>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted mb-1.5">
                2. Match columns
              </div>
              <div className="border border-border rounded-md overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border">
                      {mapping.map((_, i) => (
                        <th key={i} className="px-2 py-1.5 text-left font-bold text-muted whitespace-nowrap">
                          Col {i + 1}
                          {hasHeader && parsed[0][i] ? (
                            <span className="font-normal text-gray-500 ml-1">— {parsed[0][i]}</span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border bg-white">
                      {mapping.map((m, i) => (
                        <td key={i} className="px-2 py-1.5 align-top">
                          <ColumnMappingSelect
                            mapping={m}
                            captureFields={captureFields}
                            onChange={(next) =>
                              setMapping((cur) => {
                                const out = [...cur]
                                out[i] = next
                                return out
                              })
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Step 3 — preview */}
          {rowsForApply.length > 0 && (
            <section>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted mb-1.5">
                3. Preview first 5 rows
              </div>
              <div className="border border-border rounded-md overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="bg-gray-50 border-b border-border">
                      <th className="px-2 py-1.5 text-left font-bold text-muted">Match</th>
                      {mapping.map((_, i) => (
                        <th key={i} className="px-2 py-1.5 text-left font-bold text-muted whitespace-nowrap">
                          Col {i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForApply.slice(0, 5).map((r, ri) => (
                      <tr key={ri} className="border-b border-gray-100 bg-white">
                        <td className="px-2 py-1">
                          {r.matchedAssetId ? (
                            <span className="inline-flex items-center gap-1 text-ok font-bold">
                              <Check size={10} strokeWidth={3} />
                              {r.matchReason}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-bad font-bold">
                              <AlertTriangle size={10} strokeWidth={2.5} />
                              no match
                            </span>
                          )}
                        </td>
                        {mapping.map((m, ci) => (
                          <td
                            key={ci}
                            className={cn(
                              'px-2 py-1 whitespace-nowrap',
                              m.kind === 'ignore' && 'text-gray-300',
                            )}
                          >
                            {r.cells[ci] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-muted mt-1.5">
                {matchedCount} of {rowsForApply.length} rows match an asset.
                {' '}
                {fieldCols} field column{fieldCols === 1 ? '' : 's'} mapped.
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-gray-50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted">
            {planValueCount > 0
              ? `Will write ${planValueCount} value${planValueCount === 1 ? '' : 's'} as flagged captures.`
              : 'Paste rows + map columns to enable Apply.'}
          </div>
          <div className="flex gap-2">
            <Button size="md" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="md" variant="primary" onClick={apply} disabled={planValueCount === 0}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Internals ────────────────────────────────────────────────────────────

function ColumnMappingSelect({
  mapping,
  captureFields,
  onChange,
}: {
  mapping: ColumnMapping
  captureFields: ClassificationField[]
  onChange: (m: ColumnMapping) => void
}) {
  const value =
    mapping.kind === 'ignore'
      ? '__ignore__'
      : mapping.kind === 'asset_id'
        ? '__asset_id__'
        : mapping.kind === 'description'
          ? '__description__'
          : `field:${mapping.fieldId}`

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value
        if (v === '__ignore__') onChange({ kind: 'ignore' })
        else if (v === '__asset_id__') onChange({ kind: 'asset_id' })
        else if (v === '__description__') onChange({ kind: 'description' })
        else onChange({ kind: 'field', fieldId: Number(v.replace('field:', '')) })
      }}
      className={cn(
        'w-full px-2 py-1 rounded border border-gray-300 bg-white',
        'text-[11px] outline-none cursor-pointer',
        'focus:border-sky-deep focus:shadow-focus',
      )}
    >
      <option value="__ignore__">— ignore —</option>
      <option value="__asset_id__">Asset ID</option>
      <option value="__description__">Description</option>
      <optgroup label="Capture into field">
        {captureFields.map((f) => (
          <option key={f.id} value={`field:${f.id}`}>
            {f.display_name}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

function parseBlock(text: string): string[][] | null {
  if (!text || !text.trim()) return null
  const lines = text.split(/\r?\n/).filter((ln) => ln.trim() !== '')
  if (lines.length === 0) return null
  // Tab-first (Excel paste defaults to tab); fall back to comma if no tabs anywhere.
  const hasTab = lines.some((ln) => ln.includes('\t'))
  const sep = hasTab ? '\t' : ','
  return lines.map((ln) => ln.split(sep).map((c) => c.trim()))
}

function autodetectMapping(
  header: string[] | null,
  ncols: number,
  fields: ClassificationField[],
): ColumnMapping[] {
  // Default to ignore for every column
  const out: ColumnMapping[] = Array.from({ length: ncols }, () => ({ kind: 'ignore' }))
  if (!header) return out

  // Build a normalised lookup of field display names
  const fieldByNorm = new Map<string, ClassificationField>()
  for (const f of fields) {
    fieldByNorm.set(normaliseHeader(f.display_name), f)
  }

  for (let i = 0; i < ncols; i++) {
    const raw = header[i] ?? ''
    const norm = normaliseHeader(raw)
    if (!norm) continue
    if (norm === 'asset id' || norm === 'asset' || norm === 'id') {
      out[i] = { kind: 'asset_id' }
      continue
    }
    if (norm === 'description' || norm === 'asset description' || norm === 'desc') {
      out[i] = { kind: 'description' }
      continue
    }
    const f = fieldByNorm.get(norm)
    if (f) {
      out[i] = { kind: 'field', fieldId: f.id }
      continue
    }
    // Loose match — substring contains
    for (const [n, fld] of fieldByNorm) {
      if (norm.includes(n) || n.includes(norm)) {
        out[i] = { kind: 'field', fieldId: fld.id }
        break
      }
    }
  }
  return out
}

function normaliseHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Re-export the mapping kind helpers for completeness (not strictly needed
// outside this file, but keeps the union name available if a parent ever
// wants to introspect).
export type { ColumnMapping }
export const _MAPPING_KEYS = MAPPING_KEYS
