'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { parseMaximoXlsxAction, importAcbCollectionAction } from '@/app/(app)/testing/acb/actions'
import type { MaximoParsePreview, MaximoImportRow } from '@/app/(app)/testing/acb/actions'

type Stage = 'upload' | 'parsing' | 'preview' | 'importing' | 'done'

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
      setStage('preview')
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong reading the file.')
      setStage('upload')
    }
  }

  async function handleConfirm() {
    if (rows.length === 0) {
      onComplete()
      return
    }

    setStage('importing')
    setError(null)

    try {
      // importAcbCollectionAction expects rows with rowNumber and assetName
      const payload = {
        rows: rows.map(r => ({
          asset_id: r.asset_id,
          test_id: r.test_id,
          rowNumber: r.rowNumber,
          assetName: r.assetName,
          brand: r.brand,
          breaker_type: r.breaker_type,
          name_location: r.name_location,
          cb_serial: r.cb_serial,
          performance_level: r.performance_level,
          protection_unit_fitted: r.protection_unit_fitted,
          trip_unit_model: r.trip_unit_model,
          cb_poles: r.cb_poles,
          current_in: r.current_in,
          fixed_withdrawable: r.fixed_withdrawable,
          long_time_ir: r.long_time_ir,
          long_time_delay_tr: r.long_time_delay_tr,
          short_time_pickup_isd: r.short_time_pickup_isd,
          short_time_delay_tsd: r.short_time_delay_tsd,
          instantaneous_pickup: r.instantaneous_pickup,
          earth_fault_pickup: r.earth_fault_pickup,
          earth_fault_delay: r.earth_fault_delay,
          earth_leakage_pickup: r.earth_leakage_pickup,
          earth_leakage_delay: r.earth_leakage_delay,
          motor_charge: r.motor_charge,
          shunt_trip_mx1: r.shunt_trip_mx1,
          shunt_close_xf: r.shunt_close_xf,
          undervoltage_mn: r.undervoltage_mn,
          second_shunt_trip: r.second_shunt_trip,
        })),
      }

      const result = await importAcbCollectionAction(payload)

      if (!result.success) {
        setError(result.error)
        setStage('preview')
        return
      }

      const data = result.data ?? { updated: 0, failed: 0 }
      setImportResult({ updated: data.updated, failed: data.failed })
      setStage('done')
      onComplete()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Something went wrong writing the data.')
      setStage('preview')
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <Card className="w-full max-w-lg mx-4 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-eq-ink">Import from Maximo</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-eq-grey hover:text-eq-ink text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Stage: upload */}
        {stage === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-eq-grey">
              Upload the Maximo breaker spreadsheet (XLSM or XLSX). The file will be read on the server — no credentials or intermediate files needed.
            </p>
            <p className="text-xs text-eq-grey bg-gray-50 rounded p-3 leading-relaxed">
              Expected format: Equinix IAM ADCS_V01 — header row 12, data from row 13.
              Assets are matched to this site by their Maximo ID.
            </p>
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <Button
                onClick={() => fileRef.current?.click()}
              >
                Choose file
              </Button>
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

        {/* Stage: parsing */}
        {stage === 'parsing' && (
          <div className="space-y-3 py-4 text-center">
            <div className="text-eq-grey text-sm animate-pulse">Reading {fileName}…</div>
            <div className="text-xs text-eq-grey">Matching assets and checking for existing test records</div>
          </div>
        )}

        {/* Stage: preview */}
        {stage === 'preview' && preview && (
          <div className="space-y-4">
            <p className="text-sm text-eq-grey">File read. Review before writing to EQ Service.</p>

            {/* Summary counts */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-gray-200 p-3 text-center">
                <div className="text-2xl font-bold text-eq-sky">{preview.matched}</div>
                <div className="text-xs text-eq-grey mt-1">Assets matched</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 text-center">
                <div className={`text-2xl font-bold ${preview.unmatched > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {preview.unmatched}
                </div>
                <div className="text-xs text-eq-grey mt-1">Not matched</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{preview.newTestsCreated}</div>
                <div className="text-xs text-eq-grey mt-1">New test records</div>
              </div>
            </div>

            {/* Name mismatches */}
            {preview.nameMismatches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-700">
                  {preview.nameMismatches.length} name difference{preview.nameMismatches.length !== 1 ? 's' : ''} between EQ Service and Maximo
                  <span className="font-normal ml-1">(EQ name is kept — update manually if needed)</span>
                </p>
                <div className="max-h-40 overflow-y-auto rounded border border-amber-200 bg-amber-50 divide-y divide-amber-100">
                  {preview.nameMismatches.map((m) => (
                    <div key={m.maximoId} className="px-3 py-2 text-xs text-amber-800">
                      <span className="font-medium">Maximo {m.maximoId}</span>
                      <div className="mt-0.5 text-amber-700">EQ: {m.eqName}</div>
                      <div className="text-amber-600">Maximo: {m.maximoName}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.unmatched > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                {preview.unmatched} row{preview.unmatched !== 1 ? 's' : ''} in the file had no matching asset in this site and will be skipped.
              </p>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={handleConfirm} disabled={rows.length === 0}>
                {rows.length === 0 ? 'Nothing to import' : `Write ${rows.length} record${rows.length !== 1 ? 's' : ''}`}
              </Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Stage: importing */}
        {stage === 'importing' && (
          <div className="space-y-3 py-4 text-center">
            <div className="text-eq-grey text-sm animate-pulse">Writing collection data…</div>
            <div className="text-xs text-eq-grey">Updating {rows.length} breaker records</div>
          </div>
        )}

        {/* Stage: done */}
        {stage === 'done' && importResult && (
          <div className="space-y-4">
            <div className={`p-4 rounded-md ${importResult.failed > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
              <p className={`text-sm font-semibold ${importResult.failed > 0 ? 'text-amber-800' : 'text-green-700'}`}>
                Done — {importResult.updated} record{importResult.updated !== 1 ? 's' : ''} updated
                {importResult.failed > 0 ? `, ${importResult.failed} failed` : ''}
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
