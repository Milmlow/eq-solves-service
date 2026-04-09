/**
 * ACB Asset Collection — Excel export/import.
 *
 * Export: generates a pre-populated .xlsx with one row per asset,
 *         columns matching the asset collection form fields.
 * Import: parses an uploaded .xlsx back into update payloads.
 */
import * as XLSX from 'xlsx'
import type { AcbTest, Asset } from '@/lib/types'

/* ── Column definitions (order = Excel column order) ── */
const COLUMNS = [
  { key: 'asset_name', header: 'Asset Name', width: 28, readOnly: true },
  { key: 'serial_number', header: 'Serial Number (Asset)', width: 20, readOnly: true },
  { key: 'asset_id', header: 'Asset ID', width: 10, readOnly: true, hidden: true },
  { key: 'test_id', header: 'Test ID', width: 10, readOnly: true, hidden: true },
  // Breaker Identification
  { key: 'brand', header: 'Brand', width: 16 },
  { key: 'breaker_type', header: 'Breaker Type', width: 16 },
  { key: 'name_location', header: 'Name / Location', width: 22 },
  { key: 'cb_serial', header: 'CB Serial', width: 18 },
  { key: 'performance_level', header: 'Performance Level (N1/H1/H2/H3/L1)', width: 18 },
  { key: 'protection_unit_fitted', header: 'Protection Unit Fitted (Yes/No)', width: 16 },
  // Trip Unit & Ratings
  { key: 'trip_unit_model', header: 'Trip Unit Model', width: 20 },
  { key: 'cb_poles', header: 'Poles (3/4/Other)', width: 12 },
  { key: 'current_in', header: 'Rating IN (A)', width: 14 },
  { key: 'fixed_withdrawable', header: 'Fixed / Withdrawable', width: 16 },
  // Protection Settings
  { key: 'long_time_ir', header: 'Long Time Ir', width: 14 },
  { key: 'long_time_delay_tr', header: 'Long Time Delay tr', width: 14 },
  { key: 'short_time_pickup_isd', header: 'Short Time Isd', width: 14 },
  { key: 'short_time_delay_tsd', header: 'Short Time Delay tsd', width: 14 },
  { key: 'instantaneous_pickup', header: 'Instantaneous Pickup', width: 14 },
  { key: 'earth_fault_pickup', header: 'Earth Fault Pickup', width: 14 },
  { key: 'earth_fault_delay', header: 'Earth Fault Delay', width: 14 },
  { key: 'earth_leakage_pickup', header: 'Earth Leakage Pickup', width: 14 },
  { key: 'earth_leakage_delay', header: 'Earth Leakage Delay', width: 14 },
  // Accessories
  { key: 'motor_charge', header: 'Motor Charge', width: 16 },
  { key: 'shunt_trip_mx1', header: 'Shunt Trip MX1', width: 16 },
  { key: 'shunt_close_xf', header: 'Shunt Close XF', width: 16 },
  { key: 'undervoltage_mn', header: 'Undervoltage MN', width: 16 },
  { key: 'second_shunt_trip', header: '2nd Shunt MX2', width: 16 },
] as const

type ColDef = (typeof COLUMNS)[number]

/* ── Export ── */
export function exportAcbCollectionXlsx(
  siteName: string,
  assets: (Asset & { acb_test?: AcbTest })[],
) {
  const wb = XLSX.utils.book_new()

  // Build rows
  const headerRow = COLUMNS.map(c => c.header)
  const dataRows = assets.map(asset => {
    const t = asset.acb_test
    return COLUMNS.map(col => {
      switch (col.key) {
        case 'asset_name': return asset.name
        case 'serial_number': return asset.serial_number ?? ''
        case 'asset_id': return asset.id
        case 'test_id': return t?.id ?? ''
        case 'protection_unit_fitted':
          return t?.protection_unit_fitted === true ? 'Yes' : t?.protection_unit_fitted === false ? 'No' : ''
        default:
          return (t as Record<string, unknown>)?.[col.key] ?? ''
      }
    })
  })

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])

  // Column widths
  ws['!cols'] = COLUMNS.map(c => ({
    wch: c.width,
    hidden: 'hidden' in c && c.hidden,
  }))

  XLSX.utils.book_append_sheet(wb, ws, 'Asset Collection')

  // Trigger download
  XLSX.writeFile(wb, `ACB_Collection_${siteName}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/* ── Import ── */
export interface AcbImportRow {
  asset_id: string
  test_id: string
  data: Record<string, string | boolean | null>
}

export function parseAcbCollectionXlsx(file: File): Promise<AcbImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })

        const results: AcbImportRow[] = []

        for (const row of rows) {
          const assetId = row['Asset ID']
          const testId = row['Test ID']
          if (!assetId || !testId) continue

          const updateData: Record<string, string | boolean | null> = {}

          for (const col of COLUMNS) {
            if (col.readOnly) continue
            const cellValue = row[col.header]?.toString().trim() ?? ''

            if (col.key === 'protection_unit_fitted') {
              if (cellValue.toLowerCase() === 'yes') updateData[col.key] = true
              else if (cellValue.toLowerCase() === 'no') updateData[col.key] = false
              else updateData[col.key] = null
            } else {
              updateData[col.key] = cellValue || null
            }
          }

          results.push({ asset_id: assetId, test_id: testId, data: updateData })
        }

        resolve(results)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}
