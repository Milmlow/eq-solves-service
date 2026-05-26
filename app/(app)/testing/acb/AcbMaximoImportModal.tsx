'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { parseMaximoXlsxAction, importAcbCollectionAction } from '@/app/(app)/testing/acb/actions'
import { bulkUpdateAssetNamesAction } from '@/app/(app)/assets/actions'
import type { MaximoParsePreview, MaximoImportRow } from '@/app/(app)/testing/acb/actions'

const PERFORMANCE_LEVELS = ['N1', 'H1', 'H2', 'H3', 'L1', 'HF'] as const

type Stage = 'upload' | 'parsing' | 'review' | 'importing' | 'done'

// Per-asset name resolution: keep the EQ Service name or switch to the Maximo name
type NameChoice = 'keep-eq' | 'use-maximo'

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

  // ── Review state ──────────────────────────────────────────────────────────
  // Name choices: bulk default + per-asset overrides (asset_id → choice)
  const [bulkNameChoice, setBulkNameChoice] = useState<NameChoice>('keep-eq')
  const [nameOverrides, setNameOverrides] = useState<Record<string, NameChoice>>({})

  // Performance level overrides: asset_id → chosen level (empty string = leave blank)
  const [perfOverrides, setPerfOverrides] = useState<Record<string, string>>({})

  // Whether the user has acknowledged unmatched rows and wants to proceed
  const [unmatchedAcknowledged, setUnmatchedAcknowledged] = useState(false)

  function getNameChoice(assetId: string): NameChoice {
    return nameOverrides[assetId] ?? bulkNameChoice
  }

  function setNameChoice(assetId: string, choice: NameChoice) {
    setNameOverrides(prev => ({ ...prev, [assetId]: choice }))
  }

  function handleBulkNameChoice(choice: NameChoice) {
    setBulkNameChoice(choice)
    setNameOverrides({}) // clear per-asset overrides when bulk changes
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    setError(null)
    setStage('parsing')

    try {
      const arrayBuffer = await file.arrayBuffer()
      const fileBuffer = Array.from(new Uint8Array(arrayBuffer))
      const result = await parseMaximoXlsxAction({ site_id: siteId, fileBuffer })

      if (!result.success) {
        setError(result.error)
        setStage('upload')
        return
      }

      setPreview(result.preview)
      setRows(result.rows)
      // Pre-populate perf overrides as empty strings so dropdowns render correctly
      const initialPerf: Record<string, string> = {}
      for (const m of result.preview.missingPerformanceLevel) {
        initialPerf[m.asset_id] = ''
      }
      setPerfOverrides(initialPerf)
      setBulkNameChoice('keep-eq')
      setNameOverrides({})
      setUnmatchedAcknowledged(false)
      setStage('review')
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong reading the file.')
      setStage('upload')
    }
  }

  async function handleConfirm() {
    if (!preview) return

    // Block confirm if there are unmatched rows the user hasn't acknowledged
    if (preview.unmatched > 0 && !unmatchedAcknowledged) {
      setError('Confirm you want to skip the unmatched rows before continuing.')
      return
    }

    setStage('importing')
    setError(null)

    // ── 1. Apply name changes ────────────────────────────────────────────────
    const nameUpdates = preview.nameMismatches
      .filter(m => getNameChoice(m.assetId) === 'use-maximo')
      .map(m => ({ id: m.assetId, name: m.maximoName }))

    if (nameUpdates.length > 0) {
      const nameResult = await bulkUpdateAssetNamesAction(nameUpdates)
      if (!nameResult.success) {
        setError(`Name update failed: ${nameResult.error}`)
        setStage('review')
        return
      }
    }

    // ── 2. Apply performance level overrides to rows ─────────────────────────
    const finalRows = rows.map(r => {
      const override = perfOverrides[r.asset_id]
      if (override !== undefined) {
        return { ...r, performance_level: override || null }
      }
      return r
    })

    // ── 3. Write collection data ─────────────────────────────────────────────
    if (finalRows.length === 0) {
      onComplete()
      return
    }

    try {
      const result = await importAcbCollectionAction({ rows: finalRows })

      if (!result.success) {
        setError(result.error)
        setStage('review')
        return
      }

      const data = result.data ?? { updated: 0, failed: 0 }
      setImportResult({ updated: data.updated, failed: data.failed })
      setStage('done')
      onComplete()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong writing the data.')
      setStage('review')
    }
  }

  // Count how many names will be updated (for confirm button label)
  const nameUpdateCount = preview
    ? preview.nameMismatches.filter(m => getNameChoice(m.assetId) === 'use-maximo').length
    : 0

  // Are there any items that need a decision before we can proceed?
  const hasUnresolvedItems = preview && preview.unmatched > 0 && !unmatchedAcknowledged

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
            <button
              type="button"
              onClick={onClose}
              className="text-eq-grey hover:text-eq-ink text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          )}
        </div>

        {/* ── Upload ── */}
        {stage === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-eq-grey">
              Upload the Maximo breaker spreadsheet for this site. The file is read on the server — nothing is written until you confirm.
            </p>
            <p className="text-xs text-eq-grey bg-gray-50 rounded p-3 leading-relaxed">
              Expected format: Equinix IAM ADCS_V01 — header row 12, data from row 13. Assets are matched by Maximo ID.
            </p>
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
            )}
            <div className="flex gap-3">
              <Button onClick={() => fileRef.current?.click()}>Choose file</Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsm,.xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
          </div>
        )}

        {/* ── Parsing ── */}
        {stage === 'parsing' && (
          <div className="py-6 text-center space-y-2">
            <div className="text-eq-grey text-sm animate-pulse">Reading {fileName}…</div>
            <div className="text-xs text-eq-grey">Matching assets and checking for existing test records</div>
          </div>
        )}

        {/* ── Review ── */}
        {stage === 'review' && preview && (
          <div className="space-y-5">

            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-gray-200 p-3 text-center">
                <div className="text-2xl font-bold text-eq-sky">{preview.matched}</div>
                <div className="text-xs text-eq-grey mt-1">Assets matched</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 text-center">
                <div className={`text-2xl font-bold ${preview.unmatched > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {preview.unmatched}
                </div>
                <div className="text-xs text-eq-grey mt-1">Not found in EQ</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{preview.newTestsCreated}</div>
                <div className="text-xs text-eq-grey mt-1">New test records</div>
              </div>
            </div>

            {/* ── Section A: Unmatched rows ── */}
            {preview.unmatched > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-800">
                  {preview.unmatched} row{preview.unmatched !== 1 ? 's' : ''} not found in EQ Service
                </p>
                <p className="text-xs text-amber-700">
                  These Maximo IDs have no matching asset on this site in EQ Service. They will be skipped — no data is lost. You may want to check these asset records exist before re-running the import.
                </p>
                <div className="max-h-32 overflow-y-auto rounded border border-amber-200 bg-white divide-y divide-amber-100">
                  {preview.unmatchedDetails.map((u) => (
                    <div key={u.maximoId} className="px-3 py-2 text-xs text-amber-800 flex gap-3">
                      <span className="font-medium shrink-0">ID {u.maximoId}</span>
                      <span className="text-amber-600 truncate">{u.maximoName ?? '—'}</span>
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={unmatchedAcknowledged}
                    onChange={(e) => setUnmatchedAcknowledged(e.target.checked)}
                    className="rounded border-amber-400 text-eq-sky"
                  />
                  <span className="text-xs text-amber-800">I understand — skip these and continue with the {preview.matched} matched assets</span>
                </label>
              </div>
            )}

            {/* ── Section B: Name differences ── */}
            {preview.nameMismatches.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-eq-ink">
                    {preview.nameMismatches.length} name difference{preview.nameMismatches.length !== 1 ? 's' : ''}
                  </p>
                  {/* Bulk toggle */}
                  <div className="flex rounded-md overflow-hidden border border-gray-200 text-xs">
                    <button
                      onClick={() => handleBulkNameChoice('keep-eq')}
                      className={`px-3 py-1.5 transition-colors ${bulkNameChoice === 'keep-eq' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'}`}
                    >
                      Keep all EQ names
                    </button>
                    <button
                      onClick={() => handleBulkNameChoice('use-maximo')}
                      className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${bulkNameChoice === 'use-maximo' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'}`}
                    >
                      Use all Maximo names
                    </button>
                  </div>
                </div>
                <div className="rounded-md border border-gray-200 divide-y divide-gray-100 max-h-56 overflow-y-auto">
                  {preview.nameMismatches.map((m) => {
                    const choice = getNameChoice(m.assetId)
                    return (
                      <div key={m.assetId} className="px-3 py-2.5 flex items-start gap-3">
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="text-xs">
                            <span className={`font-medium ${choice === 'keep-eq' ? 'text-eq-ink' : 'text-gray-400 line-through'}`}>
                              EQ: {m.eqName}
                            </span>
                          </div>
                          <div className="text-xs">
                            <span className={`${choice === 'use-maximo' ? 'text-eq-ink font-medium' : 'text-gray-400'}`}>
                              Maximo: {m.maximoName}
                            </span>
                          </div>
                        </div>
                        {/* Per-asset toggle */}
                        <div className="flex rounded overflow-hidden border border-gray-200 text-xs shrink-0">
                          <button
                            onClick={() => setNameChoice(m.assetId, 'keep-eq')}
                            className={`px-2 py-1 transition-colors ${choice === 'keep-eq' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'}`}
                          >
                            EQ
                          </button>
                          <button
                            onClick={() => setNameChoice(m.assetId, 'use-maximo')}
                            className={`px-2 py-1 transition-colors border-l border-gray-200 ${choice === 'use-maximo' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'}`}
                          >
                            Maximo
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {nameUpdateCount > 0 && (
                  <p className="text-xs text-eq-grey">
                    {nameUpdateCount} asset name{nameUpdateCount !== 1 ? 's' : ''} will be updated in EQ Service to match Maximo.
                  </p>
                )}
              </div>
            )}

            {/* ── Section C: Missing performance level ── */}
            {preview.missingPerformanceLevel.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-eq-ink">
                  {preview.missingPerformanceLevel.length} breaker{preview.missingPerformanceLevel.length !== 1 ? 's' : ''} with no performance level in Maximo
                </p>
                <p className="text-xs text-eq-grey">
                  The model number didn&apos;t contain a recognised class (H1, HF, N1 etc.). Choose one for each, or leave blank to fill in later.
                </p>
                <div className="rounded-md border border-gray-200 divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {preview.missingPerformanceLevel.map((m) => (
                    <div key={m.asset_id} className="px-3 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-eq-ink truncate">{m.assetName}</p>
                        {m.rawModel && (
                          <p className="text-xs text-eq-grey truncate">Model: {m.rawModel}</p>
                        )}
                      </div>
                      <select
                        value={perfOverrides[m.asset_id] ?? ''}
                        onChange={(e) => setPerfOverrides(prev => ({ ...prev, [m.asset_id]: e.target.value }))}
                        className="h-8 px-2 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:border-eq-deep focus:ring-1 focus:ring-eq-sky/20"
                      >
                        <option value="">Leave blank</option>
                        {PERFORMANCE_LEVELS.map(l => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                onClick={handleConfirm}
                disabled={!!hasUnresolvedItems || rows.length === 0}
              >
                {rows.length === 0
                  ? 'Nothing to import'
                  : nameUpdateCount > 0
                    ? `Write ${rows.length} record${rows.length !== 1 ? 's' : ''} + rename ${nameUpdateCount}`
                    : `Write ${rows.length} record${rows.length !== 1 ? 's' : ''}`
                }
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
                {nameUpdateCount > 0 ? `, ${nameUpdateCount} asset name${nameUpdateCount !== 1 ? 's' : ''} renamed` : ''}
              </p>
              {importResult.failed > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  Some rows could not be written. Run the import again or contact support.
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
