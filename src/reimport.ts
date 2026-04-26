import type ExcelJSNs from 'exceljs'
import type { Asset, ClassificationField } from '../types/db'

// ============================================================================
// Re-import a filled Equinix capture template
//
// Flow:
//   1. User fills green cells in Excel offline, saves.
//   2. They drop the file on /j/<slug>/reimport.
//   3. We read the Assets sheet, walk each data row, extract a value for
//      every captured (green-cell) column that has a non-empty cell.
//   4. We match each row to an existing DB asset (by asset_id first, then
//      description fallback) and each column to a classification_field
//      (by spec_id / header).
//   5. Caller upserts the result into `captures` with source='file_reimport'
//      and source_file=<filename>.
//
// This module is pure — no Supabase calls. It returns what to upsert.
// ============================================================================

const HEADER_ROW = 12
const DATA_START_ROW = 13
const ASSETS_SHEET = 'Assets'
const GREEN_HEX = 'FF00FF00'

export interface ExtractedValue {
  asset_id: string // DB uuid, populated by matcher
  classification_field_id: number
  value: string
  /** For the post-run summary */
  row_number: number
  asset_ref: string // asset_id from sheet col G, else description
  spec_id: string
}

export interface ReimportResult {
  values: ExtractedValue[]
  unmatchedRows: Array<{ row_number: number; ref: string }>
  unmatchedFields: string[] // green-cell headers with no DB field match
  rowsMatched: number
  totalRowsInSheet: number
  greenCellsSeen: number // cells visited (non-empty + captured + mapped)
}

function normaliseKey(s: string | null | undefined): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[\s\u00a0\n\r]+/g, ' ')
    .replace(/[^A-Z0-9]/g, '')
    .trim()
}

function readCell(cell: ExcelJSNs.Cell): string {
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'object' && 'richText' in v && Array.isArray((v as any).richText)) {
    return (v as any).richText.map((r: any) => r.text).join('')
  }
  if (typeof v === 'object' && 'result' in v) return String((v as any).result ?? '')
  if (v instanceof Date) return v.toISOString().slice(0, 10) // YYYY-MM-DD
  return String(v).trim()
}

export async function extractCapturesFromFilledTemplate(input: {
  file: File
  assets: Asset[]
  fields: ClassificationField[]
}): Promise<ReimportResult> {
  const { file, assets, fields } = input

  const ExcelJS = (await import('exceljs')).default as typeof ExcelJSNs
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  const ws = wb.getWorksheet(ASSETS_SHEET)
  if (!ws) {
    throw new Error(
      `Sheet "${ASSETS_SHEET}" not found in the uploaded workbook. Are you sure this is an Equinix capture template?`,
    )
  }

  // ---------- 1. Walk the header row + figure out which cols are
  //              captured (green) + which classification_field each maps to.
  // The field matcher uses the normalised header key, same as import did.
  const headerRow = ws.getRow(HEADER_ROW)
  const sampleRow = ws.getRow(DATA_START_ROW)

  const fieldByNormKey = new Map<string, ClassificationField>()
  for (const f of fields) {
    fieldByNormKey.set(normaliseKey(f.spec_id), f)
  }

  interface CapturedCol {
    col: number
    header: string
    field: ClassificationField
  }
  const capturedCols: CapturedCol[] = []
  const seenHeadersWithoutField: string[] = []
  const unmatchedFields: string[] = []

  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const header = readCell(cell).trim()
    if (!header) return
    // Is this column captured? (green fill on the first data row)
    const fill = sampleRow.getCell(col).fill as any
    const fg = fill?.fgColor?.argb ?? fill?.fgColor?.rgb
    const isGreen = fg === GREEN_HEX
    if (!isGreen) return
    const field = fieldByNormKey.get(normaliseKey(header))
    if (!field) {
      seenHeadersWithoutField.push(header)
      unmatchedFields.push(header)
      return
    }
    // Only count fields the DB has marked captured — defensive, the two
    // signals should always agree but a human can edit the DB.
    if (!field.is_field_captured) return
    capturedCols.push({ col, header, field })
  })

  // ---------- 2. Build asset matcher: asset_id (col G) → DB asset, then
  //              description fallback scoped to the job's classification.
  const assetIdCol = headerColByNormKey(headerRow, 'ASSETID')
  const descCol = headerColByNormKey(headerRow, 'ASSETDESCRIPTION')
  if (!descCol) {
    throw new Error(
      'Could not locate the "Asset Description" column in the Assets sheet.',
    )
  }

  const assetByExternalId = new Map<string, Asset>()
  const assetByDesc = new Map<string, Asset>()
  for (const a of assets) {
    if (a.asset_id) assetByExternalId.set(String(a.asset_id).trim(), a)
    if (a.description) assetByDesc.set(a.description.trim(), a)
  }

  // ---------- 3. Walk data rows + collect captures
  const values: ExtractedValue[] = []
  const unmatchedRows: Array<{ row_number: number; ref: string }> = []
  let rowsMatched = 0
  let totalRowsInSheet = 0

  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const desc = readCell(row.getCell(descCol)).trim()
    if (!desc) continue // blank row
    totalRowsInSheet++

    const externalId = assetIdCol ? readCell(row.getCell(assetIdCol)).trim() : ''
    let asset: Asset | undefined
    if (externalId && assetByExternalId.has(externalId)) {
      asset = assetByExternalId.get(externalId)
    } else if (assetByDesc.has(desc)) {
      asset = assetByDesc.get(desc)
    }

    const ref = externalId || desc
    if (!asset) {
      unmatchedRows.push({ row_number: r, ref })
      continue
    }
    rowsMatched++

    for (const c of capturedCols) {
      const v = readCell(row.getCell(c.col))
      if (v === '') continue // skip empty green cells
      values.push({
        asset_id: asset.id,
        classification_field_id: c.field.id,
        value: v,
        row_number: r,
        asset_ref: ref,
        spec_id: c.field.spec_id,
      })
    }
  }

  return {
    values,
    unmatchedRows,
    unmatchedFields: Array.from(new Set(unmatchedFields)),
    rowsMatched,
    totalRowsInSheet,
    greenCellsSeen: values.length,
  }

  function headerColByNormKey(
    headerRow: ExcelJSNs.Row,
    wantKey: string,
  ): number | null {
    let found: number | null = null
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      if (found != null) return
      const h = readCell(cell).trim()
      if (!h) return
      if (normaliseKey(h) === wantKey) found = col
    })
    return found
  }
}
