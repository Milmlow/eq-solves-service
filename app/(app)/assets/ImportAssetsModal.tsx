'use client'

import { useState, useRef } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Button } from '@/components/ui/Button'
import { importAssetsAction } from './actions'
import type { Site } from '@/lib/types'
import { Upload, AlertTriangle, CheckCircle, FileText } from 'lucide-react'

interface ImportAssetsModalProps {
  open: boolean
  onClose: () => void
  sites: Pick<Site, 'id' | 'name'>[]
}

type ParsedRow = Record<string, string>

const REQUIRED_COLUMNS = ['name', 'asset_type', 'site']
const OPTIONAL_COLUMNS = ['manufacturer', 'model', 'serial_number', 'maximo_id', 'location', 'install_date']
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse (handles quoted fields with commas)
    const values: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())

    const row: ParsedRow = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? ''
    })
    rows.push(row)
  }

  return { headers, rows }
}

export function ImportAssetsModal({ open, onClose, sites }: ImportAssetsModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)

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

      // Auto-map columns by exact or fuzzy match
      const autoMap: Record<string, string> = {}
      for (const col of ALL_COLUMNS) {
        const match = h.find(
          (hdr) => hdr === col || hdr.replace(/[_\s-]/g, '') === col.replace(/[_\s-]/g, '')
        )
        if (match) autoMap[col] = match
      }
      setColumnMap(autoMap)
    }
    reader.readAsText(file)
  }

  function validate(): string[] {
    const errs: string[] = []
    for (const req of REQUIRED_COLUMNS) {
      if (!columnMap[req]) errs.push(`Required column "${req}" not mapped.`)
    }
    if (rows.length === 0) errs.push('No data rows found.')
    if (rows.length > 500) errs.push('Maximum 500 rows per import.')

    // Validate site names resolve
    if (columnMap['site']) {
      const siteNames = new Set(sites.map((s) => s.name.toLowerCase()))
      const unmapped = new Set<string>()
      for (const row of rows) {
        const siteName = row[columnMap['site']]?.toLowerCase()
        if (siteName && !siteNames.has(siteName)) unmapped.add(row[columnMap['site']])
      }
      if (unmapped.size > 0) {
        errs.push(`Unknown site names: ${[...unmapped].slice(0, 5).join(', ')}${unmapped.size > 5 ? ` (+${unmapped.size - 5} more)` : ''}`)
      }
    }
    return errs
  }

  async function handleImport() {
    const validationErrors = validate()
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    setErrors([])
    setImporting(true)

    // Build site name→id lookup
    const siteLookup: Record<string, string> = {}
    for (const s of sites) siteLookup[s.name.toLowerCase()] = s.id

    // Map rows to asset records
    const mapped = rows
      .filter((row) => row[columnMap['name']]?.trim()) // skip empty name rows
      .map((row) => ({
        name: row[columnMap['name']]?.trim() ?? '',
        asset_type: row[columnMap['asset_type']]?.trim() ?? '',
        site_id: siteLookup[row[columnMap['site']]?.toLowerCase()] ?? '',
        manufacturer: row[columnMap['manufacturer']]?.trim() || null,
        model: row[columnMap['model']]?.trim() || null,
        serial_number: row[columnMap['serial_number']]?.trim() || null,
        maximo_id: row[columnMap['maximo_id']]?.trim() || null,
        location: row[columnMap['location']]?.trim() || null,
        install_date: row[columnMap['install_date']]?.trim() || null,
      }))
      .filter((r) => r.site_id) // skip rows with unresolvable sites

    const res = await importAssetsAction(mapped)
    setImporting(false)

    if (res.success) {
      setResult({ imported: res.imported ?? 0, skipped: rows.length - (res.imported ?? 0), errors: res.rowErrors ?? [] })
    } else {
      setErrors([res.error ?? 'Import failed.'])
    }
  }

  function handleClose() {
    onClose()
    setFileName(null)
    setHeaders([])
    setRows([])
    setColumnMap({})
    setErrors([])
    setResult(null)
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title="Import Assets (CSV)">
      <div className="space-y-4">
        {/* Step 1: File upload */}
        <div>
          <p className="text-sm text-eq-grey mb-2">
            Upload a CSV file with asset data. Required columns: <strong>name</strong>, <strong>asset_type</strong>, <strong>site</strong> (must match existing site names).
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            {fileName ?? 'Choose CSV file'}
          </Button>
        </div>

        {/* Step 2: Column mapping */}
        {headers.length > 0 && !result && (
          <>
            <div className="flex items-center gap-2 text-sm text-eq-ink">
              <FileText className="w-4 h-4 text-eq-sky" />
              <span>{rows.length} rows found in {fileName}</span>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">Column Mapping</h3>
              {ALL_COLUMNS.map((col) => (
                <div key={col} className="flex items-center gap-3">
                  <span className="text-xs font-medium text-eq-ink w-28">
                    {col.replace(/_/g, ' ')}
                    {REQUIRED_COLUMNS.includes(col) && <span className="text-eq-sky ml-1">*</span>}
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
                      {ALL_COLUMNS.filter((c) => columnMap[c]).map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-eq-grey font-bold uppercase">{col.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {ALL_COLUMNS.filter((c) => columnMap[c]).map((col) => (
                          <td key={col} className="px-3 py-1.5 text-eq-ink">{row[columnMap[col]] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

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
                {importing ? 'Importing...' : `Import ${rows.length} assets`}
              </Button>
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            </div>
          </>
        )}

        {/* Step 3: Result */}
        {result && (
          <div className="space-y-3">
            <div className="bg-green-50 border border-green-200 rounded-md p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800">
                  {result.imported} asset{result.imported !== 1 ? 's' : ''} imported successfully.
                </p>
                {result.skipped > 0 && (
                  <p className="text-xs text-green-700 mt-1">{result.skipped} rows skipped (empty name or unknown site).</p>
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
