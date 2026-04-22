/**
 * Delta / Equinix Maximo Work-Order Excel Parser
 *
 * Converts the monthly `.xlsx` file that Equinix's Delta team sends
 * (one row per work order, one sheet) into structured groups that can
 * become maintenance_checks + check_assets in EQ Service.
 *
 * Spec: see auto-memory/project_delta_wo_import.md (locked 2026-04-19).
 *
 * No DB access, no React — pure parsing. Safe to run in a server action
 * or a unit test.
 */

import { Workbook, Worksheet } from 'exceljs'

// ── Frequency suffix → EQ frequency enum ────────────────────────────
// Keys match the enum values used by maintenance_checks.frequency in the
// CreateCheckForm (see app/(app)/maintenance/CreateCheckForm.tsx).

export const FREQUENCY_SUFFIX_MAP: Record<string, FrequencyEnum> = {
  A: 'annual',
  Q: 'quarterly',
  '3': 'quarterly',
  M: 'monthly',
  S: 'semi_annual',
  '6': 'semi_annual',
  W: 'weekly',
  '2': '2yr',
  '5': '5yr',
  '10': '10yr',
}

export type FrequencyEnum =
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annual'
  | 'annual'
  | '2yr'
  | '3yr'
  | '5yr'
  | '8yr'
  | '10yr'

// ── Types ───────────────────────────────────────────────────────────

export interface DeltaRow {
  /** 1-indexed row number from the source sheet, for error reporting. */
  rowNumber: number
  /** Raw site code from the sheet, e.g. "AU01-SY3". */
  site: string
  /** Site code after stripping the "AU0x-" prefix, e.g. "SY3". */
  siteCode: string
  /** Maximo work-order number, e.g. "3962180". */
  workOrder: string
  /** Asset description (usually asset name), e.g. "SY3-A1-TPL-01". */
  description: string
  /** Maximo classification path, e.g. "ELEC \\ TRNSFMR". Nullable. */
  classification: string | null
  /** Location code (rack/zone), e.g. "SY3-GF16". Nullable. */
  location: string | null
  /** Numeric-string Maximo asset ID — matches assets.maximo_id on our side. */
  maximoAssetId: string
  /** Raw job plan code from the sheet, e.g. "LVACB-A". */
  jobPlanRaw: string
  /** Job plan code portion, e.g. "LVACB". */
  jobPlanCode: string
  /** Frequency suffix portion, e.g. "A". */
  frequencySuffix: string
  /** Mapped EQ frequency, or null if the suffix is unknown. */
  frequency: FrequencyEnum | null
  /** Target start date. */
  targetStart: Date
  /** Per-row non-blocking warnings — row still emitted, flagged for preview. */
  warnings: string[]
}

export interface ParsedGroup {
  /** Stable deterministic key — site|jpCode|frequency|YYYY-MM-DD. */
  key: string
  siteCode: string
  jobPlanCode: string
  frequencySuffix: string
  frequency: FrequencyEnum | null
  startDate: Date
  rows: DeltaRow[]
}

export interface ParseError {
  /** 1-indexed source row number (0 = workbook-level error). */
  rowNumber: number
  message: string
}

export interface ParseResult {
  rows: DeltaRow[]
  groups: ParsedGroup[]
  /** Hard failures — the row was skipped and is NOT in `rows` or `groups`. */
  errors: ParseError[]
}

// ── Constants ───────────────────────────────────────────────────────

/**
 * Expected column headers in the Delta work-order export. Header row is
 * validated on parse; mismatch returns a workbook-level error with no rows.
 */
export const EXPECTED_HEADERS = [
  'Site',
  'Work Order',
  'Description',
  'Classification',
  'History',
  'Location',
  'Asset',
  'Work Type',
  'Status',
  'Job Plan',
  'Target Start',
  'Reported Date',
] as const

/**
 * The name Maximo gives the data tab in the monthly Delta export. When the
 * file also contains pivot/summary tabs (the common real-world case — see
 * `WO Aug 2025_Delta.xlsx`, which ships `Sheet1` as an active pivot), we
 * want to land on the headered tab regardless of sheet order.
 */
export const DATA_SHEET_NAME = 'List of Work Orders'

// ── Pure helpers (exported for unit testing) ────────────────────────

/**
 * Strip the "AU0x-" prefix from an Equinix Maximo site code so it matches
 * `sites.code` in EQ Service. `AU01-SY3` → `SY3`. Non-matching input is
 * returned trimmed but unchanged.
 */
export function stripSitePrefix(raw: string): string {
  const trimmed = (raw ?? '').trim()
  return trimmed.replace(/^AU\d{2}-/, '')
}

/**
 * Split a Delta-style job plan code on the LAST dash. The portion before
 * becomes the EQ `job_plans.code`; the portion after is the frequency
 * suffix. Input without a dash returns `{ code: input, suffix: '' }`.
 *
 * Examples: `LVACB-A` → { LVACB, A }, `ATS-3` → { ATS, 3 }.
 */
export function splitJobPlanCode(raw: string): { code: string; suffix: string } {
  const trimmed = (raw ?? '').trim()
  const idx = trimmed.lastIndexOf('-')
  if (idx === -1) return { code: trimmed, suffix: '' }
  return {
    code: trimmed.slice(0, idx).trim(),
    suffix: trimmed.slice(idx + 1).trim(),
  }
}

/**
 * Map a Delta frequency suffix to an EQ frequency enum value. Returns
 * null for unknown suffixes — callers must fail-closed per spec (no
 * default guess).
 */
export function mapFrequencySuffix(suffix: string): FrequencyEnum | null {
  const key = (suffix ?? '').toUpperCase()
  return FREQUENCY_SUFFIX_MAP[key] ?? null
}

/**
 * Read row 1 of a worksheet as trimmed strings, padded out to
 * EXPECTED_HEADERS length so callers can index without bounds checks.
 */
function readHeaderRow(ws: Worksheet): string[] {
  const headerRow = ws.getRow(1)
  const out: string[] = []
  for (let c = 1; c <= EXPECTED_HEADERS.length; c++) {
    const raw = headerRow.getCell(c).value
    out.push(raw == null ? '' : String(raw).trim())
  }
  return out
}

/** True when row 1 of `ws` matches every expected Delta column header. */
function headersMatch(ws: Worksheet): boolean {
  const actual = readHeaderRow(ws)
  return EXPECTED_HEADERS.every((h, i) => actual[i] === h)
}

/**
 * Pick the sheet that holds the work-order data. Maximo exports usually
 * land on `List of Work Orders`, but the file may also include pivot tabs
 * (`Sheet1`, etc.) that get marked active. Order of preference:
 *   1. Sheet named exactly DATA_SHEET_NAME, if present
 *   2. First sheet whose row 1 matches EXPECTED_HEADERS
 *   3. null — caller emits a workbook-level error
 */
export function findDataSheet(wb: Workbook): Worksheet | null {
  const named = wb.getWorksheet(DATA_SHEET_NAME)
  if (named) return named
  for (const ws of wb.worksheets) {
    if (headersMatch(ws)) return ws
  }
  return null
}

/** Compose the stable group key used for deduplication. */
export function groupKey(
  siteCode: string,
  jpCode: string,
  frequency: string,
  date: Date,
): string {
  const iso = date.toISOString().slice(0, 10)
  return `${siteCode}|${jpCode}|${frequency}|${iso}`
}

// ── Main entry ──────────────────────────────────────────────────────

/**
 * Parse a Delta work-order workbook. Accepts either an ArrayBuffer
 * (browser upload) or a Buffer (Node/test fixture).
 */
export async function parseWorkbook(
  source: ArrayBuffer | Buffer | Uint8Array,
): Promise<ParseResult> {
  const wb = new Workbook()
  // exceljs types accept Buffer; ArrayBuffer / Uint8Array also work at
  // runtime. Cast through unknown to sidestep the generic Buffer<ArrayBufferLike>
  // mismatch between @types/node and exceljs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(source as any)

  if (wb.worksheets.length === 0) {
    return {
      rows: [],
      groups: [],
      errors: [{ rowNumber: 0, message: 'Workbook contains no worksheets' }],
    }
  }

  const ws = findDataSheet(wb)
  if (!ws) {
    const available = wb.worksheets.map((w) => `"${w.name}"`).join(', ')
    return {
      rows: [],
      groups: [],
      errors: [
        {
          rowNumber: 0,
          message:
            `Could not find the work-order data tab. Expected a sheet named ` +
            `"${DATA_SHEET_NAME}" (or any sheet whose row 1 starts with ` +
            `"${EXPECTED_HEADERS[0]}, ${EXPECTED_HEADERS[1]}, ${EXPECTED_HEADERS[2]}…"). ` +
            `Available sheets: ${available}.`,
        },
      ],
    }
  }

  const errors: ParseError[] = []

  // ── Header validation ──────────────────────────────────────────────
  // findDataSheet guarantees a match when the sheet was located by header
  // scan, but the named-sheet path (DATA_SHEET_NAME) could still have a
  // mangled row 1 — validate explicitly so the user gets a precise error.
  const actualHeaders = readHeaderRow(ws)
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (actualHeaders[i] !== EXPECTED_HEADERS[i]) {
      errors.push({
        rowNumber: 1,
        message: `Column ${i + 1} header mismatch on sheet "${ws.name}": expected "${EXPECTED_HEADERS[i]}", got "${actualHeaders[i] || '(empty)'}"`,
      })
    }
  }
  if (errors.length > 0) {
    return { rows: [], groups: [], errors }
  }

  // ── Row parsing ────────────────────────────────────────────────────
  const rows: DeltaRow[] = []

  const lastRow = ws.actualRowCount
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = ws.getRow(rowNumber)
    if (!row.hasValues) continue

    const cell = (col: number): unknown => {
      const v = row.getCell(col).value
      if (v === null || v === undefined || v === '') return null
      // exceljs hyperlink / richText objects expose `.text`. The exceljs
      // union covers formula / error shapes too, so we reach them through
      // `unknown` to appease the structural check.
      const obj = v as unknown as Record<string, unknown>
      if (typeof v === 'object' && v !== null && 'text' in obj) {
        return obj.text
      }
      return v
    }

    const site = String(cell(1) ?? '').trim()
    const workOrder = String(cell(2) ?? '').trim()
    const description = String(cell(3) ?? '').trim()
    const classificationRaw = cell(4)
    const classification = classificationRaw ? String(classificationRaw).trim() : null
    const locationRaw = cell(6)
    const location = locationRaw ? String(locationRaw).trim() : null
    const assetRaw = cell(7)
    const maximoAssetId = assetRaw != null ? String(assetRaw).trim() : ''
    const jobPlanRaw = String(cell(10) ?? '').trim()
    const targetRaw = cell(11)
    const targetStart = targetRaw instanceof Date ? targetRaw : null

    // Hard-fail rows with missing critical fields.
    if (!site) {
      errors.push({ rowNumber, message: 'Missing Site' })
      continue
    }
    if (!workOrder) {
      errors.push({ rowNumber, message: 'Missing Work Order' })
      continue
    }
    if (!maximoAssetId) {
      errors.push({ rowNumber, message: 'Missing Asset (Maximo ID)' })
      continue
    }
    if (!jobPlanRaw) {
      errors.push({ rowNumber, message: 'Missing Job Plan' })
      continue
    }
    if (!targetStart) {
      errors.push({ rowNumber, message: 'Missing or non-date Target Start' })
      continue
    }

    const siteCode = stripSitePrefix(site)
    const { code: jobPlanCode, suffix: frequencySuffix } = splitJobPlanCode(jobPlanRaw)

    if (!jobPlanCode) {
      errors.push({
        rowNumber,
        message: `Cannot parse job plan code from "${jobPlanRaw}"`,
      })
      continue
    }

    const frequency = mapFrequencySuffix(frequencySuffix)
    const warnings: string[] = []
    if (!frequency) {
      warnings.push(
        `Unknown frequency suffix "${frequencySuffix}" — manual frequency assignment required`,
      )
    }

    rows.push({
      rowNumber,
      site,
      siteCode,
      workOrder,
      description,
      classification,
      location,
      maximoAssetId,
      jobPlanRaw,
      jobPlanCode,
      frequencySuffix,
      frequency,
      targetStart,
      warnings,
    })
  }

  // ── Group rows by (site, jp_code, frequency, start_date) ──────────
  const groupMap = new Map<string, ParsedGroup>()
  for (const r of rows) {
    // Rows with unknown frequency still group — key uses the raw suffix so
    // the preview can show the group and prompt for manual assignment.
    const freqForKey = r.frequency ?? `unknown:${r.frequencySuffix}`
    const k = groupKey(r.siteCode, r.jobPlanCode, freqForKey, r.targetStart)
    let g = groupMap.get(k)
    if (!g) {
      g = {
        key: k,
        siteCode: r.siteCode,
        jobPlanCode: r.jobPlanCode,
        frequencySuffix: r.frequencySuffix,
        frequency: r.frequency,
        startDate: r.targetStart,
        rows: [],
      }
      groupMap.set(k, g)
    }
    g.rows.push(r)
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    // Sort by asset count descending, then site+jpCode — deterministic for
    // both UX (biggest group first) and test assertions.
    if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length
    return `${a.siteCode}|${a.jobPlanCode}`.localeCompare(`${b.siteCode}|${b.jobPlanCode}`)
  })

  return { rows, groups, errors }
}
