import type ExcelJSNs from 'exceljs'

// ============================================================================
// Template parser
//
// Given any Equinix-format IAM asset spreadsheet, this module:
//   1. Identifies the classification and site from the Assets sheet
//   2. Extracts the green-cell fields for that classification (schema)
//   3. Extracts the pre-filled asset rows (descriptions, location, etc.)
//   4. Pulls LOV options from the Specifications tab
//   5. Returns a normalised seed bundle ready to insert into Supabase
//
// The same logic that powered the offline extract script (Python) runs here
// in the browser so Royce / field leads can onboard new jobs without code.
// ============================================================================

const HEADER_ROW = 12
const TYPE_ROW = 11
const DATA_START_ROW = 13
const GREEN_HEX = 'FF00FF00'

export interface ParsedField {
  spec_id: string
  display_name: string
  definition: string | null
  sample_values: string | null
  data_type: 'LOV' | 'NUM' | 'FREETEXT' | 'DATE' | 'CURRENCY' | 'AUTOFILLED'
  display_order: number
  is_field_captured: boolean
  field_group: string | null
  options: string[]
}

export interface ParsedAsset {
  row_number: number
  asset_id: string | null
  description: string
  classification_code: string
  location_id: string | null
  location_description: string | null
  manufacturer: string | null
  model: string | null
  serial: string | null
  source_row: Record<string, unknown>
}

export interface ParsedTemplate {
  detectedSite: string | null
  detectedClassification: string | null
  classifications: string[] // all classifications present (usually 1)
  fieldsByClassification: Record<string, ParsedField[]>
  assets: ParsedAsset[]
  warnings: string[]
  templateFilename: string
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
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export async function parseTemplate(file: File): Promise<ParsedTemplate> {
  const ExcelJS = (await import('exceljs')).default as typeof ExcelJSNs
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  const warnings: string[] = []

  // ---------- 1. Assets sheet: header & type rows ----------
  const assetsWs = wb.getWorksheet('Assets')
  if (!assetsWs) throw new Error('No "Assets" sheet found in the workbook.')

  // Gather column metadata
  const cols: Array<{
    col: number
    header: string
    normKey: string
    dataType: string
    isGreen: boolean
  }> = []
  const typeRow = assetsWs.getRow(TYPE_ROW)
  const headerRow = assetsWs.getRow(HEADER_ROW)
  const sampleRow = assetsWs.getRow(DATA_START_ROW)
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const header = readCell(cell).trim()
    if (!header) return
    const dataType = readCell(typeRow.getCell(col)).trim() || 'FREETEXT'
    const fill = sampleRow.getCell(col).fill as any
    const fg = fill?.fgColor?.argb ?? fill?.fgColor?.rgb
    cols.push({
      col,
      header,
      normKey: normaliseKey(header),
      dataType,
      isGreen: fg === GREEN_HEX,
    })
  })

  const colByNormKey = new Map(cols.map((c) => [c.normKey, c]))

  // ---------- 2. Read Specifications tab for LOV options ----------
  const lovByKey = new Map<string, string[]>()
  const specWs = wb.getWorksheet('Specifications')
  if (specWs) {
    const fieldNameRow = specWs.getRow(2)
    fieldNameRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const name = readCell(cell).trim()
      if (!name) return
      const vals: string[] = []
      for (let r = 3; r <= specWs.rowCount; r++) {
        const v = readCell(specWs.getRow(r).getCell(col)).trim()
        if (v) vals.push(v)
      }
      if (vals.length) lovByKey.set(normaliseKey(name), vals)
    })
  } else {
    warnings.push('No "Specifications" sheet — LOV dropdowns will be empty.')
  }

  // ---------- 3. Read Specification Descriptions tab for field metadata ----------
  // Each row: Group | Classification | Asset Type Desc | Spec ID | Spec Description | Definition | Sample Values
  const fieldsByClassification: Record<string, ParsedField[]> = {}
  const sdWs = wb.getWorksheet('Specification Descriptions')

  // Typo map between Spec Descriptions and Assets header row (from extraction work)
  const SPEC_REMAP: Record<string, string> = {
    [normaliseKey('BREAKER CONSTUCTION')]: normaliseKey('BREAKER CONSTRUCTION'),
    [normaliseKey('INST (X IN (II)')]: normaliseKey('INST(X IN) (LI)'),
    [normaliseKey('MAX # OF LOOPS')]: normaliseKey('MAX NUMBER OF LOOPS'),
  }

  if (sdWs) {
    for (let r = 7; r <= sdWs.rowCount; r++) {
      const row = sdWs.getRow(r)
      const group = readCell(row.getCell(1)).trim() || null
      const cls = readCell(row.getCell(2)).trim()
      const specId = readCell(row.getCell(4)).trim()
      const specDesc = readCell(row.getCell(5)).trim() || specId
      const defn = readCell(row.getCell(6)).trim() || null
      const samples = readCell(row.getCell(7)).trim() || null
      if (!cls || !specId) continue

      const norm = normaliseKey(specId)
      const remapped = SPEC_REMAP[norm] ?? norm
      const assetsCol = colByNormKey.get(remapped) ?? [...colByNormKey.values()].find(
        (c) => c.normKey.startsWith(remapped) || remapped.startsWith(c.normKey),
      )

      const canonicalHeader = assetsCol?.header ?? specId
      const canonicalNorm = assetsCol?.normKey ?? remapped

      const field: ParsedField = {
        spec_id: canonicalHeader,
        display_name: specDesc,
        definition: defn,
        sample_values: samples,
        data_type: (assetsCol?.dataType as ParsedField['data_type']) ?? 'FREETEXT',
        display_order: fieldsByClassification[cls]?.length ?? 0,
        is_field_captured: Boolean(assetsCol?.isGreen),
        field_group: group,
        options: lovByKey.get(canonicalNorm) ?? [],
      }
      if (!fieldsByClassification[cls]) fieldsByClassification[cls] = []
      fieldsByClassification[cls].push(field)
    }
  } else {
    warnings.push('No "Specification Descriptions" sheet — fields cannot be inferred.')
  }

  // ---------- 4. Assets ----------
  const assets: ParsedAsset[] = []
  const descCol = colByNormKey.get(normaliseKey('Asset Description'))?.col
  if (!descCol) throw new Error('Could not locate "Asset Description" column in Assets sheet.')

  for (let r = DATA_START_ROW; r <= assetsWs.rowCount; r++) {
    const desc = readCell(assetsWs.getRow(r).getCell(descCol)).trim()
    if (!desc) continue

    const rowData: Record<string, unknown> = {}
    for (const c of cols) {
      const v = assetsWs.getRow(r).getCell(c.col).value
      if (v != null) {
        if (v instanceof Date) rowData[c.header] = v.toISOString()
        else rowData[c.header] = typeof v === 'object' ? readCell(assetsWs.getRow(r).getCell(c.col)) : v
      }
    }

    assets.push({
      row_number: r,
      asset_id: (rowData['Asset ID'] as string | undefined) ?? null,
      description: desc,
      classification_code: (rowData['Classification'] as string | undefined) ?? '',
      location_id: (rowData['LOC ID'] as string | undefined) ?? null,
      location_description: (rowData['Location Description'] as string | undefined) ?? null,
      manufacturer: (rowData['MANUFACTURER'] as string | undefined) ?? null,
      model: (rowData['Model #'] as string | undefined) ?? null,
      serial: (rowData['Serial#'] as string | undefined) ?? null,
      source_row: rowData,
    })
  }

  const uniqueClassifications = Array.from(
    new Set(assets.map((a) => a.classification_code).filter(Boolean)),
  )

  // ---------- 5. Heuristics: detect site + primary classification ----------
  // Site comes from col F "Site ID" (first data row), or from the filename
  const siteIdCol = colByNormKey.get(normaliseKey('Site ID'))?.col
  let detectedSite: string | null = null
  if (siteIdCol) {
    const v = readCell(assetsWs.getRow(DATA_START_ROW).getCell(siteIdCol))
    if (v) {
      // e.g. "AU01-SY6" → "SY6"
      const m = v.match(/(?:^|-)([A-Z]{2,3}\d+[A-Z]?)$/i)
      detectedSite = m ? m[1].toUpperCase() : v
    }
  }
  if (!detectedSite) {
    const m = file.name.match(/(SY\d+|LD\d+|TY\d+|NY\d+|CH\d+|SG\d+|LO\d+|ME\d+|BR\d+|PA\d+)/i)
    if (m) detectedSite = m[1].toUpperCase()
  }

  const detectedClassification =
    uniqueClassifications.length === 1
      ? uniqueClassifications[0]
      : uniqueClassifications.length > 1
        ? uniqueClassifications[0]
        : null

  if (uniqueClassifications.length > 1) {
    warnings.push(
      `Workbook contains ${uniqueClassifications.length} classifications: ${uniqueClassifications.join(', ')}. One job per classification will be created.`,
    )
  }

  return {
    detectedSite,
    detectedClassification,
    classifications: uniqueClassifications,
    fieldsByClassification,
    assets,
    warnings,
    templateFilename: file.name,
  }
}
