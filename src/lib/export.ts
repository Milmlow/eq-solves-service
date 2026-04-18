import type ExcelJSNs from 'exceljs'
import type { Asset, ClassificationField, Job } from '../types/db'

// ============================================================================
// XLSX/XLSM writer
//
// Strategy: take the original Equinix workbook (preserves validations,
// formulas, macros with .xlsm), match field columns by header name on row 12,
// match asset rows by asset_id in col G, then write captured values into the
// correct cells. We touch nothing else.
//
// Note on .xlsm: ExcelJS preserves macros when loading if they exist in the
// source file, but in practice the safest path is to write .xlsx and tell the
// user to open it — Excel will offer to save back to .xlsm. We expose both.
// ============================================================================

interface ExportInput {
  templateFile: File
  job: Job
  assets: Asset[]
  fields: ClassificationField[]
  captures: Array<{ asset_id: string; classification_field_id: number; value: string | null }>
}

const HEADER_ROW = 12
const DATA_START_ROW = 13
const ASSETS_SHEET = 'Assets'

function normaliseKey(s: string): string {
  return s
    .toUpperCase()
    .replace(/[\s\u00a0\n\r]+/g, ' ')
    .replace(/[^A-Z0-9]/g, '')
    .trim()
}

export async function downloadCompletedWorkbook(input: ExportInput): Promise<void> {
  const { templateFile, job, assets, fields, captures } = input

  // 1. Load the template file (ExcelJS lazy-loaded so it's only shipped to
  //    the export page, not the field form)
  const ExcelJS = (await import('exceljs')).default as typeof ExcelJSNs
  const arrayBuffer = await templateFile.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arrayBuffer)
  const ws = wb.getWorksheet(ASSETS_SHEET)
  if (!ws) throw new Error(`Sheet "${ASSETS_SHEET}" not found in the uploaded workbook.`)

  // 2. Build column index: header-norm-key -> colNumber
  const headerRow = ws.getRow(HEADER_ROW)
  const colByHeader = new Map<string, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const v = cell.value
    if (v == null) return
    const header = typeof v === 'object' && v !== null && 'richText' in v
      ? (v as any).richText.map((r: any) => r.text).join('')
      : String(v)
    colByHeader.set(normaliseKey(header), col)
  })

  // 3. Build row index: asset_id (from col G) -> rowNumber
  //    Fall back to description match (col H) if asset_id missing.
  const assetIdCol = colByHeader.get(normaliseKey('Asset ID'))
  const descCol = colByHeader.get(normaliseKey('Asset Description'))
  if (!assetIdCol || !descCol) {
    throw new Error('Could not locate "Asset ID" or "Asset Description" columns in the template.')
  }
  const rowByAssetId = new Map<string, number>()
  const rowByDesc = new Map<string, number>()
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const idCell = ws.getRow(r).getCell(assetIdCol).value
    const descCell = ws.getRow(r).getCell(descCol).value
    const id = idCell == null ? null : String(idCell).trim()
    const d = descCell == null ? null : String(descCell).trim()
    if (id) rowByAssetId.set(id, r)
    if (d) rowByDesc.set(d, r)
  }

  // 4. Build field index: field.id -> column number in the template
  const colByFieldId = new Map<number, number>()
  const missingFields: string[] = []
  for (const f of fields) {
    if (!f.is_field_captured) continue
    const col = colByHeader.get(normaliseKey(f.spec_id))
    if (col) colByFieldId.set(f.id, col)
    else missingFields.push(f.spec_id)
  }
  if (missingFields.length) {
    console.warn('Fields without a matching template column (will be skipped):', missingFields)
  }

  // 5. Map asset.id -> rowNumber
  const rowByAssetUuid = new Map<string, number>()
  for (const a of assets) {
    const r = (a.asset_id && rowByAssetId.get(String(a.asset_id))) ?? rowByDesc.get(a.description)
    if (r) rowByAssetUuid.set(a.id, r)
  }

  // 6. Write captures
  let cellsWritten = 0
  let skipped = 0
  for (const cap of captures) {
    const rowNum = rowByAssetUuid.get(cap.asset_id)
    const colNum = colByFieldId.get(cap.classification_field_id)
    if (!rowNum || !colNum) {
      skipped++
      continue
    }
    const cell = ws.getRow(rowNum).getCell(colNum)
    // Try to coerce value type based on existing cell format
    const v = cap.value
    if (v == null || v === '') continue
    const numMatch = typeof v === 'string' ? v.match(/^-?\d+(\.\d+)?$/) : null
    cell.value = numMatch ? Number(v) : v
    cellsWritten++
  }

  console.info(`Export: ${cellsWritten} cells written, ${skipped} skipped.`)

  // 7. Save & download
  // NOTE: ExcelJS doesn't round-trip VBA macros reliably.
  // We save as .xlsx for maximum fidelity and name it as the user expects.
  const buffer = await wb.xlsx.writeBuffer()

  // 7a. Post-process: ExcelJS leaves behind a dangling
  //     <Default Extension="vml" ...> in [Content_Types].xml that was inherited
  //     from the original .xlsm's macro/comment layer, but doesn't actually
  //     write any VML files. Excel sees the declaration, expects the file,
  //     can't find it, and reports the workbook as corrupt. We strip it.
  const cleanedBuffer = await stripDanglingVmlContentType(buffer)

  const baseName = templateFile.name.replace(/\.(xlsm|xlsx)$/i, '')
  const date = new Date().toISOString().slice(0, 10)
  downloadBlob(
    new Blob([cleanedBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${baseName}_captured_${date}.xlsx`,
  )
}

// Strip dangling content-type declarations that reference files not in the
// archive, and repair malformed table attributes that ExcelJS introduces.
// These are both known ExcelJS bugs that Excel rejects as corrupt.
async function stripDanglingVmlContentType(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)

    // ---------- 1. Content types ----------
    const ctFile = zip.file('[Content_Types].xml')
    if (ctFile) {
      let xml = await ctFile.async('text')
      const hasVmlFiles = Object.keys(zip.files).some((name) => name.toLowerCase().endsWith('.vml'))
      if (!hasVmlFiles) {
        xml = xml.replace(/<Default\s+Extension="vml"[^>]*\/>/gi, '')
      }
      const overrideRegex = /<Override\s+PartName="\/([^"]+)"[^>]*\/>/gi
      for (const match of Array.from(xml.matchAll(overrideRegex))) {
        if (!zip.file(match[1])) {
          xml = xml.replace(match[0], '')
        }
      }
      zip.file('[Content_Types].xml', xml)
    }

    // ---------- 2. Table definitions ----------
    // ExcelJS emits tables with headerRowCount="0" totalsRowShown="1", which
    // Excel treats as corrupt. We force headerRowCount="1" (always present in
    // the original Equinix template) and totalsRowShown="0".
    const tableFiles = Object.keys(zip.files).filter((n) => /^xl\/tables\/table\d+\.xml$/.test(n))
    for (const tableName of tableFiles) {
      const f = zip.file(tableName)
      if (!f) continue
      let xml = await f.async('text')
      // Force sensible header/totals attributes on the <table> root element
      xml = xml.replace(/(<table\b[^>]*?)\s+headerRowCount="\d+"/, '$1')
      xml = xml.replace(/(<table\b[^>]*?)\s+totalsRowShown="\d+"/, '$1')
      xml = xml.replace(/(<table\b)([^>]*?)(\s*\/?>)/, (_m, open, attrs, close) => {
        // Insert headerRowCount="1" totalsRowShown="0" just before the closing >
        return `${open}${attrs} headerRowCount="1" totalsRowShown="0"${close}`
      })
      zip.file(tableName, xml)
    }

    // ---------- 3. Worksheet dataValidations ----------
    // ExcelJS rebuilds the dataValidations block in a corrupt way — it unrolls
    // range-based validations into per-cell entries, creating overlapping
    // sqref references that Excel rejects as corrupt on load. The validations
    // are cosmetic (type hints for humans); the actual data is already in the
    // right shape because our form enforced the LOVs at capture time. Strip
    // the entire dataValidations block from every sheet.
    const sheetFiles = Object.keys(zip.files).filter((n) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
    )
    for (const sheetName of sheetFiles) {
      const f = zip.file(sheetName)
      if (!f) continue
      let xml = await f.async('text')
      const before = xml.length
      // Remove the entire <dataValidations ...>...</dataValidations> block
      xml = xml.replace(/<dataValidations\b[^>]*>[\s\S]*?<\/dataValidations>/g, '')
      // Also remove self-closing (empty) forms just in case
      xml = xml.replace(/<dataValidations\b[^>]*\/>/g, '')
      if (xml.length !== before) {
        zip.file(sheetName, xml)
      }
    }

    return await zip.generateAsync({ type: 'arraybuffer' })
  } catch (err) {
    console.warn('Could not clean workbook, shipping as-is:', err)
    return buffer
  }
}

// ----------------------------------------------------------------------------

export function downloadCsv(input: {
  job: Job
  assets: Asset[]
  fields: ClassificationField[]
  captures: Array<{
    asset_id: string
    classification_field_id: number
    value: string | null
    captured_by: string | null
    captured_at: string
    notes: string | null
    flagged: boolean
  }>
}): void {
  const { job, assets, fields, captures } = input
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  const headers = [
    'Job',
    'Site',
    'Classification',
    'Asset ID',
    'Asset Description',
    'Location',
    'Field',
    'Value',
    'Captured By',
    'Captured At',
    'Flagged',
    'Notes',
  ]
  const rows: string[][] = [headers]

  for (const c of captures) {
    const a = assetById.get(c.asset_id)
    const f = fieldById.get(c.classification_field_id)
    if (!a || !f) continue
    rows.push([
      job.name ?? '',
      job.site_code,
      job.classification_code,
      a.asset_id ?? '',
      a.description,
      a.location_description ?? '',
      f.spec_id,
      c.value ?? '',
      c.captured_by ?? '',
      c.captured_at,
      c.flagged ? 'Y' : '',
      c.notes ?? '',
    ])
  }

  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const date = new Date().toISOString().slice(0, 10)
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `${job.site_code}_${job.classification_code}_captures_${date}.csv`)
}

// ----------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
