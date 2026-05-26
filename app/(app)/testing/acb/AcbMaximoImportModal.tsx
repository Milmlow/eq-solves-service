'use client'

import { useRef, useState, useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { parseMaximoXlsxAction, importAcbCollectionAction } from '@/app/(app)/testing/acb/actions'
import { bulkUpdateAssetNamesAction } from '@/app/(app)/assets/actions'
import type { MaximoParsePreview, MaximoImportRow } from '@/app/(app)/testing/acb/actions'

// ── Field definitions ─────────────────────────────────────────────────────────
// Fields a user can meaningfully fill in during review.
// Protection settings (long_time_ir etc.) are excluded — they're null because
// protection_unit_fitted is false, which is correct behaviour.
const ASKABLE_FIELDS = [
  { key: 'cb_poles',           label: 'Number of poles',      type: 'select', options: ['3', '4', 'Other'] },
  { key: 'performance_level',  label: 'Performance class',    type: 'select', options: ['N1', 'H1', 'H2', 'H3', 'L1', 'HF'] },
  { key: 'brand',              label: 'Brand',                type: 'text' },
  { key: 'breaker_type',       label: 'Breaker type',         type: 'text' },
  { key: 'cb_serial',          label: 'Serial number',        type: 'text' },
  { key: 'current_in',         label: 'Rating (A)',           type: 'text' },
  { key: 'fixed_withdrawable', label: 'Fixed / Withdrawable', type: 'select', options: ['Fixed', 'Withdrawable'] },
  { key: 'trip_unit_model',    label: 'Trip unit model',      type: 'text' },
] as const

type FieldKey = typeof ASKABLE_FIELDS[number]['key']
type FieldDecision = 'fill' | 'skip'
type NameChoice = 'keep-eq' | 'use-maximo'
type Stage = 'upload' | 'parsing' | 'review' | 'importing' | 'done'

interface Props {
  siteId: string
  onClose: () => void
  onComplete: () => void
}

export function AcbMaximoImportModal({ siteId, onClose, onComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('upload')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<MaximoParsePreview | null>(null)
  const [rows, setRows] = useState<MaximoImportRow[]>([])
  const [importResult, setImportResult] = useState<{ updated: number; failed: number } | null>(null)

  // ── Name resolution ───────────────────────────────────────────────────────
  const [bulkNameChoice, setBulkNameChoice] = useState<NameChoice>('keep-eq')
  const [nameOverrides, setNameOverrides] = useState<Record<string, NameChoice>>({})

  // ── Unmatched acknowledgement ─────────────────────────────────────────────
  const [unmatchedAcknowledged, setUnmatchedAcknowledged] = useState(false)

  // ── Blank field resolution ────────────────────────────────────────────────
  // fieldDecisions[key] = 'fill' | 'skip' — bulk decision per field
  const [fieldDecisions, setFieldDecisions] = useState<Partial<Record<FieldKey, FieldDecision>>>({})
  // fieldValues[key][asset_id] = typed value
  const [fieldValues, setFieldValues] = useState<Partial<Record<FieldKey, Record<string, string>>>>({})
  // fieldSkipped[key] = Set of asset_ids the user has individually skipped
  const [fieldSkipped, setFieldSkipped] = useState<Partial<Record<FieldKey, Set<string>>>>({})
  // bulkApplyValue[key] = the "apply same value to all" input
  const [bulkApplyValue, setBulkApplyValue] = useState<Partial<Record<FieldKey, string>>>({})

  // ── Derived: map of asset_id → rawModel for performance level hints ──────
  const rawModelByAssetId = useMemo((): Record<string, string> => {
    if (!preview) return {}
    const map: Record<string, string> = {}
    for (const m of preview.missingPerformanceLevel) {
      if (m.rawModel) map[m.asset_id] = m.rawModel
    }
    return map
  }, [preview])

  // ── Derived: which rows have blank values per askable field ───────────────
  const blanksByField = useMemo((): Partial<Record<FieldKey, MaximoImportRow[]>> => {
    const result: Partial<Record<FieldKey, MaximoImportRow[]>> = {}
    for (const field of ASKABLE_FIELDS) {
      const blank = rows.filter(r => {
        const v = r[field.key as keyof MaximoImportRow]
        return v === null || v === undefined || v === ''
      })
      if (blank.length > 0) result[field.key] = blank
    }
    return result
  }, [rows])

  // ── Helper: name choice ───────────────────────────────────────────────────
  function getNameChoice(assetId: string): NameChoice {
    return nameOverrides[assetId] ?? bulkNameChoice
  }
  function setNameChoice(assetId: string, choice: NameChoice) {
    setNameOverrides(prev => ({ ...prev, [assetId]: choice }))
  }
  function handleBulkNameChoice(choice: NameChoice) {
    setBulkNameChoice(choice)
    setNameOverrides({})
  }

  // ── Helper: field value get/set ───────────────────────────────────────────
  function getFieldValue(key: FieldKey, assetId: string): string {
    return fieldValues[key]?.[assetId] ?? ''
  }
  function setFieldValue(key: FieldKey, assetId: string, value: string) {
    setFieldValues(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [assetId]: value },
    }))
  }
  function isSkipped(key: FieldKey, assetId: string): boolean {
    return fieldSkipped[key]?.has(assetId) ?? false
  }
  function toggleSkip(key: FieldKey, assetId: string) {
    setFieldSkipped(prev => {
      const set = new Set(prev[key] ?? [])
      if (set.has(assetId)) set.delete(assetId)
      else set.add(assetId)
      return { ...prev, [key]: set }
    })
  }
  function applyBulkValue(key: FieldKey) {
    const val = bulkApplyValue[key] ?? ''
    if (!val) return
    const affected = blanksByField[key] ?? []
    setFieldValues(prev => {
      const existing = prev[key] ?? {}
      const next = { ...existing }
      for (const r of affected) {
        // Only fill rows the user hasn't individually skipped — skips stay intact.
        if (!isSkipped(key, r.asset_id)) next[r.asset_id] = val
      }
      return { ...prev, [key]: next }
    })
    // Intentionally NOT clearing fieldSkipped: individually-skipped rows should
    // stay skipped after a bulk-apply. Previously this wiped all skips, meaning
    // a skipped row would silently get the bulk value on confirm.
  }

  // ── File upload ───────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    // Base64 adds ~33% overhead. 6 MB raw → ~8 MB base64, but Netlify caps
    // function bodies at 6 MB, so guard at ~4.5 MB raw to stay under the wire.
    if (file.size > 4.5 * 1024 * 1024) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB — max ~4.5 MB). If your spreadsheet is larger, contact support.`)
      return
    }
    setFileName(file.name)
    setError(null)
    setStage('parsing')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Encode in chunks to avoid call-stack overflow on large files.
      let binary = ''
      const chunkSize = 8192
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const fileBase64 = btoa(binary)
      const result = await parseMaximoXlsxAction({ site_id: siteId, fileBase64 })
      if (!result.success) { setError(result.error); setStage('upload'); return }
      setPreview(result.preview)
      setRows(result.rows)
      setBulkNameChoice('keep-eq')
      setNameOverrides({})
      setUnmatchedAcknowledged(false)
      setFieldDecisions({})
      setFieldValues({})
      setFieldSkipped({})
      setBulkApplyValue({})
      setStage('review')
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong reading the file.')
      setStage('upload')
    }
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!preview) return
    if (preview.unmatched > 0 && !unmatchedAcknowledged) {
      setError('Tick the checkbox to confirm you want to skip the unmatched rows.')
      return
    }

    setStage('importing')
    setError(null)

    // 1. Apply name updates
    const nameUpdates = preview.nameMismatches
      .filter(m => getNameChoice(m.assetId) === 'use-maximo')
      .map(m => ({ id: m.assetId, name: m.maximoName }))
    if (nameUpdates.length > 0) {
      const r = await bulkUpdateAssetNamesAction(nameUpdates)
      if (!r.success) { setError(`Name update failed: ${r.error}`); setStage('review'); return }
    }

    // 2. Apply blank field overrides to rows
    const finalRows = rows.map(r => {
      const patch: Partial<MaximoImportRow> = {}
      for (const field of ASKABLE_FIELDS) {
        if (fieldDecisions[field.key] !== 'fill') continue
        if (isSkipped(field.key, r.asset_id)) continue
        const val = getFieldValue(field.key, r.asset_id)
        if (val) (patch as Record<string, unknown>)[field.key] = val
      }
      return { ...r, ...patch }
    })

    // 3. Write collection data
    if (finalRows.length === 0) {
      // Nothing to write — show the done screen before calling onComplete so
      // the modal doesn't get torn down while still in 'importing' stage.
      setImportResult({ updated: 0, failed: 0 })
      setStage('done')
      onComplete()
      return
    }
    try {
      const result = await importAcbCollectionAction({ rows: finalRows })
      if (!result.success) { setError(result.error); setStage('review'); return }
      const data = result.data ?? { updated: 0, failed: 0 }
      setImportResult({ updated: data.updated, failed: data.failed })
      setStage('done')
      onComplete()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong writing the data.')
      setStage('review')
    }
  }

  const nameUpdateCount = preview
    ? preview.nameMismatches.filter(m => getNameChoice(m.assetId) === 'use-maximo').length
    : 0
  const hasBlankFields = Object.keys(blanksByField).length > 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget && stage !== 'importing') onClose() }}
    >
      <Card className="w-full max-w-2xl mx-4 p-6 space-y-5 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-eq-ink">Import from Maximo</h3>
          {stage !== 'importing' && (
            <button type="button" onClick={onClose}
              className="text-eq-grey hover:text-eq-ink text-xl leading-none" aria-label="Close">
              &times;
            </button>
          )}
        </div>

        {/* ── Upload ── */}
        {stage === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-eq-grey">
              Upload the Maximo breaker spreadsheet for this site. When the file is read, new test records are created for any breakers that don&apos;t have one yet. Collection data is written when you confirm on the next screen.
            </p>
            <p className="text-xs text-eq-grey bg-gray-50 rounded p-3 leading-relaxed">
              Expected format: Equinix IAM ADCS_V01 — header row 12, data from row 13. Assets are matched by Maximo ID.
            </p>
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
            <div className="flex gap-3">
              <Button onClick={() => fileRef.current?.click()}>Choose file</Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
            <input ref={fileRef} type="file" accept=".xlsm,.xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
          </div>
        )}

        {/* ── Parsing ── */}
        {stage === 'parsing' && (
          <div className="py-6 text-center space-y-2">
            <div className="text-eq-grey text-sm animate-pulse">Reading {fileName}…</div>
            <div className="text-xs text-eq-grey">Matching assets and preparing review</div>
          </div>
        )}

        {/* ── Review ── */}
        {stage === 'review' && preview && (
          <div className="space-y-6">

            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3">
              <SummaryTile value={preview.matched} label="Assets matched" colour="sky" />
              <SummaryTile value={preview.unmatched} label="Not found in EQ" colour={preview.unmatched > 0 ? 'amber' : 'grey'} />
              <SummaryTile value={preview.newTestsCreated} label="New test records" colour="green" />
            </div>

            {/* ── A: Unmatched rows ── */}
            {preview.unmatched > 0 && (
              <ReviewSection title={`${preview.unmatched} row${preview.unmatched !== 1 ? 's' : ''} not found in EQ Service`} intent="warning">
                <p className="text-xs text-amber-700">
                  These Maximo IDs have no matching asset on this site. They will be skipped — check they exist in EQ Service before re-running if needed.
                </p>
                <ScrollList>
                  {preview.unmatchedDetails.map(u => (
                    <div key={u.maximoId} className="px-3 py-2 text-xs text-amber-800 flex gap-3">
                      <span className="font-medium shrink-0">ID {u.maximoId}</span>
                      <span className="text-amber-600 truncate">{u.maximoName ?? '—'}</span>
                    </div>
                  ))}
                </ScrollList>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={unmatchedAcknowledged}
                    onChange={e => setUnmatchedAcknowledged(e.target.checked)}
                    className="rounded border-amber-400 text-eq-sky" />
                  <span className="text-xs text-amber-800">
                    Skip these and continue with the {preview.matched} matched assets
                  </span>
                </label>
              </ReviewSection>
            )}

            {/* ── B: Name differences ── */}
            {preview.nameMismatches.length > 0 && (
              <ReviewSection
                title={`${preview.nameMismatches.length} name difference${preview.nameMismatches.length !== 1 ? 's' : ''}`}
                action={
                  <BulkToggle
                    left="Keep EQ names" right="Use Maximo names"
                    value={bulkNameChoice === 'keep-eq' ? 'left' : 'right'}
                    onChange={v => handleBulkNameChoice(v === 'left' ? 'keep-eq' : 'use-maximo')}
                  />
                }
              >
                <ScrollList>
                  {preview.nameMismatches.map(m => {
                    const choice = getNameChoice(m.assetId)
                    return (
                      <div key={m.assetId} className="px-3 py-2.5 flex items-start gap-3">
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className={`text-xs ${choice === 'keep-eq' ? 'text-eq-ink font-medium' : 'text-gray-400 line-through'}`}>
                            EQ: {m.eqName}
                          </p>
                          <p className={`text-xs ${choice === 'use-maximo' ? 'text-eq-ink font-medium' : 'text-gray-400'}`}>
                            Maximo: {m.maximoName}
                          </p>
                        </div>
                        <BulkToggle
                          left="EQ" right="Maximo"
                          value={choice === 'keep-eq' ? 'left' : 'right'}
                          onChange={v => setNameChoice(m.assetId, v === 'left' ? 'keep-eq' : 'use-maximo')}
                          small
                        />
                      </div>
                    )
                  })}
                </ScrollList>
                {nameUpdateCount > 0 && (
                  <p className="text-xs text-eq-grey">
                    {nameUpdateCount} asset name{nameUpdateCount !== 1 ? 's' : ''} will be renamed in EQ Service to the Maximo name.
                  </p>
                )}
              </ReviewSection>
            )}

            {/* ── C: Blank fields ── */}
            {hasBlankFields && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-eq-ink">Missing data from Maximo</h4>
                  <p className="text-xs text-eq-grey mt-0.5">
                    These fields weren&apos;t in the Maximo file. Fill them in now or leave blank and update later from Breaker Details.
                  </p>
                </div>

                {ASKABLE_FIELDS.map(field => {
                  const affected = blanksByField[field.key]
                  if (!affected || affected.length === 0) return null
                  const decision = fieldDecisions[field.key]

                  return (
                    <ReviewSection
                      key={field.key}
                      title={`${field.label} — blank for ${affected.length} breaker${affected.length !== 1 ? 's' : ''}`}
                      action={
                        <div className="flex gap-2">
                          <DecisionButton
                            active={decision === 'fill'}
                            onClick={() => setFieldDecisions(prev => ({ ...prev, [field.key]: 'fill' }))}
                          >
                            Yes, fill in
                          </DecisionButton>
                          <DecisionButton
                            active={decision === 'skip'}
                            onClick={() => setFieldDecisions(prev => ({ ...prev, [field.key]: 'skip' }))}
                          >
                            No, skip
                          </DecisionButton>
                        </div>
                      }
                    >
                      {decision === 'fill' && (
                        <div className="space-y-2">
                          {/* Bulk apply helper */}
                          <div className="flex gap-2 items-center pb-1">
                            <span className="text-xs text-eq-grey shrink-0">Apply same value to all:</span>
                            <FieldInput
                              fieldDef={field}
                              value={bulkApplyValue[field.key] ?? ''}
                              onChange={v => setBulkApplyValue(prev => ({ ...prev, [field.key]: v }))}
                              placeholder="Type then click Apply"
                              small
                            />
                            <button
                              onClick={() => applyBulkValue(field.key)}
                              className="text-xs text-eq-sky hover:text-eq-deep font-medium shrink-0"
                            >
                              Apply to all
                            </button>
                          </div>

                          {/* Per-asset inputs */}
                          <ScrollList>
                            {affected.map(r => {
                              const skipped = isSkipped(field.key, r.asset_id)
                              // For performance_level, show the raw Maximo model
                              // string so the user can infer the class manually.
                              const hint = field.key === 'performance_level'
                                ? rawModelByAssetId[r.asset_id]
                                : undefined
                              return (
                                <div key={r.asset_id} className={`px-3 py-2 flex items-start gap-3 ${skipped ? 'opacity-40' : ''}`}>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs text-eq-ink truncate block">{r.assetName}</span>
                                    {hint && !skipped && (
                                      <span className="text-xs text-eq-grey">Model: {hint}</span>
                                    )}
                                  </div>
                                  {!skipped && (
                                    <FieldInput
                                      fieldDef={field}
                                      value={getFieldValue(field.key, r.asset_id)}
                                      onChange={v => setFieldValue(field.key, r.asset_id, v)}
                                      small
                                    />
                                  )}
                                  <button
                                    onClick={() => toggleSkip(field.key, r.asset_id)}
                                    className="text-xs text-eq-grey hover:text-eq-ink shrink-0 mt-0.5"
                                  >
                                    {skipped ? 'Undo skip' : 'Skip'}
                                  </button>
                                </div>
                              )
                            })}
                          </ScrollList>
                        </div>
                      )}
                      {decision === 'skip' && (
                        <p className="text-xs text-eq-grey italic">
                          {field.label} will be left blank for all {affected.length} breaker{affected.length !== 1 ? 's' : ''}.
                        </p>
                      )}
                      {!decision && (
                        <p className="text-xs text-eq-grey italic">Choose an option above.</p>
                      )}
                    </ReviewSection>
                  )
                })}
              </div>
            )}

            {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                onClick={handleConfirm}
                disabled={(preview.unmatched > 0 && !unmatchedAcknowledged) || rows.length === 0}
              >
                {rows.length === 0 ? 'Nothing to import' : buildConfirmLabel(rows.length, nameUpdateCount)}
              </Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>

          </div>
        )}

        {/* ── Importing ── */}
        {stage === 'importing' && (
          <div className="py-6 text-center space-y-2">
            <div className="text-eq-grey text-sm animate-pulse">Writing collection data…</div>
            <div className="text-xs text-eq-grey">Updating {rows.length} breaker records</div>
          </div>
        )}

        {/* ── Done ── */}
        {stage === 'done' && importResult && (
          <div className="space-y-4">
            <div className={`p-4 rounded-md ${importResult.failed > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
              <p className={`text-sm font-semibold ${importResult.failed > 0 ? 'text-amber-800' : 'text-green-700'}`}>
                Done — {importResult.updated} record{importResult.updated !== 1 ? 's' : ''} updated
                {importResult.failed > 0 ? `, ${importResult.failed} failed` : ''}
                {nameUpdateCount > 0 ? `, ${nameUpdateCount} asset${nameUpdateCount !== 1 ? 's' : ''} renamed` : ''}
              </p>
              {importResult.failed > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  Some rows couldn&apos;t be written. Run the import again or fill them in manually from Breaker Details.
                </p>
              )}
            </div>
            <Button onClick={onClose}>Close</Button>
          </div>
        )}

      </Card>
    </div>
  )
}

// ── Small components ──────────────────────────────────────────────────────────

function SummaryTile({ value, label, colour }: { value: number; label: string; colour: 'sky' | 'amber' | 'grey' | 'green' }) {
  const colourClass = colour === 'sky' ? 'text-eq-sky' : colour === 'amber' ? 'text-amber-600' : colour === 'green' ? 'text-green-600' : 'text-gray-400'
  return (
    <div className="rounded-md border border-gray-200 p-3 text-center">
      <div className={`text-2xl font-bold ${colourClass}`}>{value}</div>
      <div className="text-xs text-eq-grey mt-1">{label}</div>
    </div>
  )
}

function ReviewSection({ title, action, intent = 'neutral', children }: {
  title: string
  action?: React.ReactNode
  intent?: 'warning' | 'neutral'
  children: React.ReactNode
}) {
  const border = intent === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'
  return (
    <div className={`rounded-md border ${border} p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-eq-ink">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

function ScrollList({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white divide-y divide-gray-100">
      {children}
    </div>
  )
}

function BulkToggle({ left, right, value, onChange, small = false }: {
  left: string; right: string
  value: 'left' | 'right'
  onChange: (v: 'left' | 'right') => void
  small?: boolean
}) {
  const base = small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs'
  return (
    <div className="flex rounded overflow-hidden border border-gray-200 shrink-0">
      <button onClick={() => onChange('left')}
        className={`${base} transition-colors ${value === 'left' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'}`}>
        {left}
      </button>
      <button onClick={() => onChange('right')}
        className={`${base} transition-colors border-l border-gray-200 ${value === 'right' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'}`}>
        {right}
      </button>
    </div>
  )
}

function DecisionButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded border transition-colors ${
        active ? 'bg-eq-sky text-white border-eq-sky' : 'bg-white text-eq-grey border-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

type FieldDef = typeof ASKABLE_FIELDS[number]

function FieldInput({ fieldDef, value, onChange, placeholder, small = false }: {
  fieldDef: FieldDef; value: string; onChange: (v: string) => void
  placeholder?: string; small?: boolean
}) {
  const cls = `border border-gray-200 rounded bg-white focus:outline-none focus:border-eq-deep focus:ring-1 focus:ring-eq-sky/20 ${small ? 'h-7 px-2 text-xs' : 'h-8 px-2 text-sm'}`
  if (fieldDef.type === 'select') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
        <option value="">—</option>
        {(fieldDef as Extract<FieldDef, { type: 'select' }>).options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${cls} w-32`}
    />
  )
}

function buildConfirmLabel(rowCount: number, nameUpdates: number): string {
  const parts = [`Write ${rowCount} record${rowCount !== 1 ? 's' : ''}`]
  if (nameUpdates > 0) parts.push(`rename ${nameUpdates}`)
  return parts.join(' + ')
}
