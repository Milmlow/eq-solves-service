'use client'

import { useState, useRef } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Button } from '@/components/ui/Button'
import { parseCSV, autoMapColumns } from '@/lib/utils/csv-parser'
import type { ParsedRow } from '@/lib/utils/csv-parser'
import { Upload, AlertTriangle, CheckCircle, FileText } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Config interface — each entity defines one of these               */
/* ------------------------------------------------------------------ */

export interface ImportCSVConfig<T> {
  /** Display name shown in the panel title, e.g. "Assets" */
  entityName: string
  /** Columns the user MUST map (e.g. ['name', 'asset_type', 'site']) */
  requiredColumns: string[]
  /** Optional columns the user CAN map */
  optionalColumns: string[]
  /**
   * Additional validation before import. Return error strings.
   * Good for checking lookups like site name → id.
   */
  validate?: (rows: ParsedRow[], columnMap: Record<string, string>) => string[]
  /**
   * Map a parsed CSV row → the shape expected by the server action.
   * Return null to skip the row.
   */
  mapRow: (row: ParsedRow, columnMap: Record<string, string>) => T | null
  /** Server action that does the actual insert. */
  importAction: (items: T[]) => Promise<{
    success: boolean
    imported?: number
    rowErrors?: string[]
    error?: string
  }>
}

/* ------------------------------------------------------------------ */
/*  Component props                                                   */
/* ------------------------------------------------------------------ */

interface ImportCSVModalProps<T> {
  open: boolean
  onClose: () => void
  config: ImportCSVConfig<T>
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function ImportCSVModal<T>({ open, onClose, config }: ImportCSVModalProps<T>) {
  const {
    entityName,
    requiredColumns,
    optionalColumns,
    validate,
    mapRow,
    importAction,
  } = config

  const allColumns = [...requiredColumns, ...optionalColumns]

  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)

  /* ---- File select ---- */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    setErrors([])

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { headers: h, rows: r } = parseCSV(text)
      setHeaders(h)
      setRows(r)
      setColumnMap(autoMapColumns(h, allColumns))
    }
    reader.readAsText(file)
  }

  /* ---- Validation ---- */
  function runValidation(): string[] {
    const errs: string[] = []
    for (const req of requiredColumns) {
      if (!columnMap[req]) errs.push(`Required column "${req.replace(/_/g, ' ')}" not mapped.`)
    }
    if (rows.length === 0) errs.push('No data rows found.')
    if (rows.length > 500) errs.push('Maximum 500 rows per import.')
    if (validate) errs.push(...validate(rows, columnMap))
    return errs
  }

  /* ---- Import ---- */
  async function handleImport() {
    const validationErrors = runValidation()
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    setErrors([])
    setImporting(true)

    const mapped = rows
      .map((row) => mapRow(row, columnMap))
      .filter((r): r is T => r !== null)

    const res = await importAction(mapped)
    setImporting(false)

    if (res.success) {
      setResult({
        imported: res.imported ?? 0,
        skipped: rows.length - (res.imported ?? 0),
        errors: res.rowErrors ?? [],
      })
    } else {
      setErrors([res.error ?? 'Import failed.'])
    }
  }

  /* ---- Reset & close ---- */
  function handleClose() {
    onClose()
    setFileName(null)
    setHeaders([])
    setRows([])
    setColumnMap({})
    setErrors([])
    setResult(null)
  }

  /* ---- Label helper ---- */
  const label = entityName.toLowerCase()

  return (
    <SlidePanel open={open} onClose={handleClose} title={`Import ${entityName} (CSV)`}>
      <div className="space-y-4">
        {/* Step 1 — file upload */}
        <div>
          <p className="text-sm text-eq-grey mb-2">
            Upload a CSV file with {label} data. Required columns:{' '}
            {requiredColumns.map((c, i) => (
              <span key={c}>
                <strong>{c.replace(/_/g, ' ')}</strong>
                {i < requiredColumns.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1.5" />
            {fileName ?? 'Choose CSV file'}
          </Button>
        </div>

        {/* Step 2 — column mapping + preview */}
        {headers.length > 0 && !result && (
          <>
            <div className="flex items-center gap-2 text-sm text-eq-ink">
              <FileText className="w-4 h-4 text-eq-sky" />
              <span>{rows.length} rows found in {fileName}</span>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">Column Mapping</h3>
              {allColumns.map((col) => (
                <div key={col} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-eq-ink w-28">
                    {col.replace(/_/g, ' ')}
                    {requiredColumns.includes(col) && <span className="text-eq-sky ml-1">*</span>}
                  </span>
                  <select
                    value={columnMap[col] ?? ''}
                    onChange={(e) => setColumnMap({ ...columnMap, [col]: e.target.value })}
                    className="flex-1 h-8 px-3 border border-gray-200 rounded text-xs text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
                  >
                    <option value="">— skip —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <div>
              <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Preview (first 5 rows)</h3>
              <div className="overflow-x-auto border border-gray-200 rounded-md">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {allColumns.filter((c) => columnMap[c]).map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-eq-grey font-bold uppercase">{col.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {allColumns.filter((c) => columnMap[c]).map((col) => (
                          <td key={col} className="px-3 py-1.5 text-eq-ink">{row[columnMap[col]] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Errors */}
            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 space-y-1">
                {errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {err}
                  </p>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? 'Importing...' : `Import ${rows.length} ${label}`}
              </Button>
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            </div>
          </>
        )}

        {/* Step 3 — result */}
        {result && (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-md p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800">
                  {result.imported} {label} imported successfully.
                </p>
                {result.skipped > 0 && (
                  <p className="text-xs text-green-700 mt-1">{result.skipped} rows skipped.</p>
                )}
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-1">
                <p className="text-xs font-bold text-amber-800">Row-level errors:</p>
                {result.errors.slice(0, 10).map((err, i) => (
                  <p key={i} className="text-xs text-amber-700">{err}</p>
                ))}
                {result.errors.length > 10 && (
                  <p className="text-xs text-amber-600">...and {result.errors.length - 10} more</p>
                )}
              </div>
            )}
            <Button variant="secondary" onClick={handleClose}>Done</Button>
          </div>
        )}
      </div>
    </SlidePanel>
  )
}
