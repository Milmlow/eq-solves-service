/**
 * ACB Asset Collection — Excel Import / Export
 *
 * Uses `exceljs` (no known high-severity vulnerabilities).
 * Two functions:
 *   exportAcbCollectionXlsx  — build workbook → browser download
 *   parseAcbCollectionXlsx   — read uploaded .xlsx → AcbImportRow[]
 */

import type { Cell, Row } from 'exceljs'
import { Workbook } from 'exceljs'

// ── Column definitions ──────────────────────────────────────────────
// Keys, headers, widths, and hidden flags must stay identical to the
// original xlsx-based implementation.

interface ColumnDef {
  key: string
  header: string
  width: number
  hidden?: boolean
  readOnly?: boolean
}

const COLUMNS: ColumnDef[] = [
  { key: 'asset_id',              header: 'Asset ID',              width: 12, hidden: true,  readOnly: true },
  { key: 'test_id',               header: 'Test ID',               width: 12, hidden: true,  readOnly: true },
  { key: 'asset_name',            header: 'Asset Name',            width: 22, readOnly: true },
  { key: 'brand',                 header: 'Brand',                 width: 16 },
  { key: 'breaker_type',          header: 'Breaker Type',          width: 16 },
  { key: 'name_location',         header: 'Name / Location / CB',  width: 22 },
  { key: 'cb_serial',             header: 'Serial Number',         width: 16 },
  { key: 'performance_level',     header: 'Performance Level',     width: 16 },
  { key: 'protection_unit_fitted', header: 'Protection Unit',      width: 14 },
  { key: 'trip_unit_model',       header: 'Trip Unit Model',       width: 16 },
  { key: 'cb_poles',              header: 'Poles',                 width: 10 },
  { key: 'current_in',            header: 'Breaker Rating (IN)',   width: 16 },
  { key: 'fixed_withdrawable',    header: 'Fixed / Withdrawable',  width: 18 },
  { key: 'long_time_ir',          header: 'Long Time Ir',          width: 14 },
  { key: 'long_time_delay_tr',    header: 'Long Time Delay tr',    width: 16 },
  { key: 'short_time_pickup_isd', header: 'Short Time Isd',        width: 14 },
  { key: 'short_time_delay_tsd',  header: 'Short Time Delay tsd',  width: 16 },
  { key: 'instantaneous_pickup',  header: 'Instantaneous Ii',      width: 16 },
  { key: 'earth_fault_pickup',    header: 'Earth Fault Ig',        width: 14 },
  { key: 'earth_fault_delay',     header: 'Earth Fault Delay tg',  width: 16 },
  { key: 'earth_leakage_pickup',  header: 'Earth Leakage',         width: 14 },
  { key: 'earth_leakage_delay',   header: 'Earth Leakage Delay',   width: 16 },
  { key: 'motor_charge',          header: 'Motor Charge',          width: 14 },
  { key: 'shunt_trip_mx1',        header: 'Shunt Trip (MX1)',      width: 14 },
  { key: 'shunt_close_xf',        header: 'Shunt Close (XF)',      width: 14 },
  { key: 'undervoltage_mn',       header: 'Undervoltage (MN)',     width: 16 },
  { key: 'second_shunt_trip',     header: '2nd Shunt Trip (MX2)',  width: 16 },
]

// ── Import row type ─────────────────────────────────────────────────

export interface AcbImportRow {
  asset_id: string
  test_id: string
  brand: string | null
  breaker_type: string | null
  name_location: string | null
  cb_serial: string | null
  performance_level: string | null
  protection_unit_fitted: boolean | null
  trip_unit_model: string | null
  cb_poles: string | null
  current_in: string | null
  fixed_withdrawable: string | null
  long_time_ir: string | null
  long_time_delay_tr: string | null
  short_time_pickup_isd: string | null
  short_time_delay_tsd: string | null
  instantaneous_pickup: string | null
  earth_fault_pickup: string | null
  earth_fault_delay: string | null
  earth_leakage_pickup: string | null
  earth_leakage_delay: string | null
  motor_charge: string | null
  shunt_trip_mx1: string | null
  shunt_close_xf: string | null
  undervoltage_mn: string | null
  second_shunt_trip: string | null
}

// ── Asset shape expected by the exporter ────────────────────────────

interface AcbExportAsset {
  id: string
  name: string
  acb_test?: {
    id: string
    brand?: string | null
    breaker_type?: string | null
    name_location?: string | null
    cb_serial?: string | null
    performance_level?: string | null
    protection_unit_fitted?: boolean | null
    trip_unit_model?: string | null
    cb_poles?: string | null
    current_in?: string | null
    fixed_withdrawable?: string | null
    long_time_ir?: string | null
    long_time_delay_tr?: string | null
    short_time_pickup_isd?: string | null
    short_time_delay_tsd?: string | null
    instantaneous_pickup?: string | null
    earth_fault_pickup?: string | null
    earth_fault_delay?: string | null
    earth_leakage_pickup?: string | null
    earth_leakage_delay?: string | null
    motor_charge?: string | null
    shunt_trip_mx1?: string | null
    shunt_close_xf?: string | null
    undervoltage_mn?: string | null
    second_shunt_trip?: string | null
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function serializeProtection(value: boolean | null | undefined): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return ''
}

function deserializeProtection(value: string): boolean | null {
  const v = (value ?? '').trim()
  if (v.toLowerCase() === 'yes') return true
  if (v.toLowerCase() === 'no') return false
  return null
}

function cellStr(cell: Cell): string {
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '')
  return String(v).trim()
}

// ── Export ───────────────────────────────────────────────────────────

export async function exportAcbCollectionXlsx(
  siteName: string,
  assets: AcbExportAsset[],
): Promise<void> {
  const wb = new Workbook()
  const ws = wb.addWorksheet('ACB Asset Collection')

  // Define columns (exceljs uses 1-based index)
  ws.columns = COLUMNS.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width,
    hidden: col.hidden ?? false,
  }))

  // Style header row
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true, size: 10 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  }
  headerRow.alignment = { vertical: 'middle', wrapText: true }
  headerRow.commit()

  // Add data rows
  for (const asset of assets) {
    const t = asset.acb_test
    ws.addRow({
      asset_id: asset.id,
      test_id: t?.id ?? '',
      asset_name: asset.name,
      brand: t?.brand ?? '',
      breaker_type: t?.breaker_type ?? '',
      name_location: t?.name_location ?? '',
      cb_serial: t?.cb_serial ?? '',
      performance_level: t?.performance_level ?? '',
      protection_unit_fitted: serializeProtection(t?.protection_unit_fitted),
      trip_unit_model: t?.trip_unit_model ?? '',
      cb_poles: t?.cb_poles ?? '',
      current_in: t?.current_in ?? '',
      fixed_withdrawable: t?.fixed_withdrawable ?? '',
      long_time_ir: t?.long_time_ir ?? '',
      long_time_delay_tr: t?.long_time_delay_tr ?? '',
      short_time_pickup_isd: t?.short_time_pickup_isd ?? '',
      short_time_delay_tsd: t?.short_time_delay_tsd ?? '',
      instantaneous_pickup: t?.instantaneous_pickup ?? '',
      earth_fault_pickup: t?.earth_fault_pickup ?? '',
      earth_fault_delay: t?.earth_fault_delay ?? '',
      earth_leakage_pickup: t?.earth_leakage_pickup ?? '',
      earth_leakage_delay: t?.earth_leakage_delay ?? '',
      motor_charge: t?.motor_charge ?? '',
      shunt_trip_mx1: t?.shunt_trip_mx1 ?? '',
      shunt_close_xf: t?.shunt_close_xf ?? '',
      undervoltage_mn: t?.undervoltage_mn ?? '',
      second_shunt_trip: t?.second_shunt_trip ?? '',
    })
  }

  // Write to buffer → blob → browser download
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${siteName.replace(/[^a-zA-Z0-9_-]/g, '_')}_ACB_Collection.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Import ──────────────────────────────────────────────────────────

const READ_ONLY_KEYS = new Set(
  COLUMNS.filter(c => c.readOnly).map(c => c.key),
)

export async function parseAcbCollectionXlsx(
  file: File,
): Promise<AcbImportRow[]> {
  const arrayBuffer = await file.arrayBuffer()
  const wb = new Workbook()
  await wb.xlsx.load(arrayBuffer as ArrayBuffer)

  const ws = wb.worksheets[0]
  if (!ws) return []

  // Build header→column-key map from the first row
  const headerRow = ws.getRow(1)
  const headerToKey = new Map<number, string>()
  headerRow.eachCell((cell: Cell, colNumber: number) => {
    const headerText = cellStr(cell)
    const col = COLUMNS.find(c => c.header === headerText)
    if (col) headerToKey.set(colNumber, col.key)
  })

  const rows: AcbImportRow[] = []

  ws.eachRow((row: Row, rowNumber: number) => {
    if (rowNumber === 1) return // skip header

    // Build a keyed object from this row
    const obj: Record<string, string> = {}
    headerToKey.forEach((key, colNumber) => {
      obj[key] = cellStr(row.getCell(colNumber))
    })

    // Skip rows missing Asset ID or Test ID
    if (!obj.asset_id || !obj.test_id) return

    const importRow: AcbImportRow = {
      asset_id: obj.asset_id,
      test_id: obj.test_id,
      brand: null,
      breaker_type: null,
      name_location: null,
      cb_serial: null,
      performance_level: null,
      protection_unit_fitted: null,
      trip_unit_model: null,
      cb_poles: null,
      current_in: null,
      fixed_withdrawable: null,
      long_time_ir: null,
      long_time_delay_tr: null,
      short_time_pickup_isd: null,
      short_time_delay_tsd: null,
      instantaneous_pickup: null,
      earth_fault_pickup: null,
      earth_fault_delay: null,
      earth_leakage_pickup: null,
      earth_leakage_delay: null,
      motor_charge: null,
      shunt_trip_mx1: null,
      shunt_close_xf: null,
      undervoltage_mn: null,
      second_shunt_trip: null,
    }

    // Populate non-read-only fields
    for (const [key, value] of Object.entries(obj)) {
      if (READ_ONLY_KEYS.has(key)) continue
      if (key === 'asset_id' || key === 'test_id') continue

      if (key === 'protection_unit_fitted') {
        importRow.protection_unit_fitted = deserializeProtection(value)
      } else if (key in importRow) {
        ;(importRow as unknown as Record<string, unknown>)[key] = value || null
      }
    }

    rows.push(importRow)
  })

  return rows
}
