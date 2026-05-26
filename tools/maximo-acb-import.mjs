#!/usr/bin/env node
/**
 * maximo-acb-import.mjs
 *
 * Bridges the Equinix Maximo BREAKER spreadsheet to the EQ Service ACB
 * collection import format.
 *
 * What it does:
 *   1. Reads the Maximo XLSM (header on row 12, data from row 13)
 *   2. For each row, looks up the asset in EQ Service by maximo_id (col G)
 *   3. Creates an acb_tests row if one doesn't already exist
 *   4. Transforms spreadsheet fields to EQ collection format
 *   5. Outputs an XLSX the EQ Service import UI can accept directly
 *
 * Usage:
 *   node tools/maximo-acb-import.mjs <path-to-spreadsheet.xlsm> [output.xlsx]
 *
 * Environment variables required:
 *   NEXT_PUBLIC_SUPABASE_URL   — e.g. https://urjhmkhbgaxrofurpbgc.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (bypasses RLS)
 *
 * Install deps if missing:
 *   npm install exceljs @supabase/supabase-js dotenv
 */

import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'
import exceljs from 'exceljs'
const { Workbook } = exceljs
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// ── Load env ──────────────────────────────────────────────────────────────────
// fileURLToPath handles Windows drive letters correctly (avoids leading slash)
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const envPath    = path.resolve(__dirname, '..', '.env.local')
dotenv.config({ path: envPath })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── CLI args ──────────────────────────────────────────────────────────────────
// Usage: node tools/maximo-acb-import.mjs <spreadsheet.xlsm> [output.xlsx] [SITE_CODE]
// SITE_CODE (e.g. SY7) restricts the asset lookup to one site, preventing
// false matches when the same Maximo IDs appear on assets in multiple sites.
const inputPath  = process.argv[2]
const outputPath = process.argv[3] ?? 'maximo-acb-import-ready.xlsx'
const siteCode   = process.argv[4] ?? null

if (!inputPath) {
  console.error('Usage: node tools/maximo-acb-import.mjs <spreadsheet.xlsm> [output.xlsx] [SITE_CODE]')
  console.error('Example: node tools/maximo-acb-import.mjs breakers.xlsm output.xlsx SY7')
  process.exit(1)
}

// ── Maximo spreadsheet layout ─────────────────────────────────────────────────
// Headers are on row 12 (1-indexed). Data starts row 13.
// Column letters from the Equinix IAM ADCS_V01 format.
const MAXIMO_HEADER_ROW = 12   // 1-indexed
const MAXIMO_DATA_START = 13   // 1-indexed

// Column indices (1-indexed, matching the spreadsheet's column order)
// Derived from the agent's structural analysis of the XLSM.
const COL = {
  ASSET_ID:             7,   // G  — Maximo asset number (1050–1085), match key
  ASSET_DESC:           8,   // H  — Asset description → name_location
  MANUFACTURER:         18,  // R  — Brand (SCHNEIDER)
  MODEL_NO:             19,  // S  — Model # → extract performance_level suffix
  SERIAL_NO:            20,  // T  — Serial number → cb_serial
  AMP_FRAME:            34,  // AH — Amp frame → current_in
  BREAKER_CONSTRUCTION: 41,  // AO — ACB / MCCB → breaker_type
  BREAKER_MOUNT:        42,  // AP — DRAWOUT/FIXED → fixed_withdrawable
  GROUND_FAULT_DELAY:   58,  // BF — earth_fault_delay
  GROUND_FAULT_PICKUP:  59,  // BG — earth_fault_pickup
  INST_PICKUP:          62,  // BJ — instantaneous_pickup
  LONG_TIME_DELAY:      71,  // BS — long_time_delay_tr
  LONG_TIME_PICKUP:     72,  // BT — long_time_ir
  SHORT_TIME_DELAY:     97,  // CS — short_time_delay_tsd
  SHORT_TIME_PICKUP:    98,  // CT — short_time_pickup_isd
  TRIP_MODEL:           103, // CY — trip_unit_model; also drives protection_unit_fitted
}

// ── EQ import column headers (must match acb-excel.ts COLUMNS exactly) ────────
const EQ_HEADERS = [
  'Asset ID',
  'Test ID',
  'Asset Name',
  'Brand',
  'Breaker Type',
  'Name / Location / CB',
  'Serial Number',
  'Performance Level',
  'Protection Unit',
  'Trip Unit Model',
  'Poles',
  'Breaker Rating (IN)',
  'Fixed / Withdrawable',
  'Long Time Ir',
  'Long Time Delay tr',
  'Short Time Isd',
  'Short Time Delay tsd',
  'Instantaneous Ii',
  'Earth Fault Ig',
  'Earth Fault Delay tg',
  'Earth Leakage',
  'Earth Leakage Delay',
  'Motor Charge',
  'Shunt Trip (MX1)',
  'Shunt Close (XF)',
  'Undervoltage (MN)',
  '2nd Shunt Trip (MX2)',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return null if the value is a "no micrologic" sentinel or blank. */
function cleanProtection(val) {
  if (!val) return null
  const s = String(val).trim()
  if (!s || s.toLowerCase().startsWith('no micrologic') || s === 'N/A') return null
  return s
}

/** Extract performance level suffix from model number, e.g. "NW32 H1" → "H1" */
function extractPerformanceLevel(model) {
  if (!model) return null
  const parts = String(model).trim().split(/\s+/)
  const last = parts[parts.length - 1]?.toUpperCase()
  const valid = ['N1', 'H1', 'H2', 'H3', 'L1', 'HF']
  return valid.includes(last) ? last : null
}

/** Map BREAKER CONSTRUCTION → short breaker_type label */
function mapBreakerType(construction) {
  if (!construction) return null
  const s = String(construction).toUpperCase()
  if (s.includes('AIR CIRCUIT') || s.startsWith('ACB')) return 'ACB'
  if (s.includes('MOLDED CASE') || s.includes('MOULDED CASE') || s.startsWith('MCCB')) return 'MCCB'
  if (s.includes('INSULATED CASE') || s.startsWith('ICB')) return 'ICB'
  return String(construction).trim()
}

/** Map BREAKER MOUNT → Fixed / Withdrawable */
function mapMount(mount) {
  if (!mount) return null
  const s = String(mount).toUpperCase()
  if (s === 'DRAWOUT' || s === 'DRAW-OUT') return 'Withdrawable'
  if (s === 'FIXED') return 'Fixed'
  return String(mount).trim()
}

/** Get a cell value from a row by 1-indexed column number. */
function cell(row, colIndex) {
  const c = row.getCell(colIndex)
  const v = c?.value
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && 'result' in v) return v.result ?? null  // formula cell
  if (typeof v === 'object' && v instanceof Date) return v.toISOString().split('T')[0]
  return String(v).trim() || null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nReading spreadsheet: ${inputPath}`)
  const wb = new Workbook()
  await wb.xlsx.readFile(inputPath)

  const sheet = wb.worksheets[0]
  if (!sheet) {
    console.error('No worksheet found in workbook.')
    process.exit(1)
  }
  console.log(`Sheet: "${sheet.name}"  (${sheet.rowCount} rows)`)

  // Collect data rows
  const maximoRows = []
  sheet.eachRow((row, rowNum) => {
    if (rowNum < MAXIMO_DATA_START) return
    const assetId = cell(row, COL.ASSET_ID)
    if (!assetId) return  // skip empty rows
    maximoRows.push({ rowNum, row, assetId })
  })
  console.log(`Found ${maximoRows.length} data rows`)

  // ── Look up assets in EQ Service ──────────────────────────────────────────
  const maximoIds = maximoRows.map(r => r.assetId)
  console.log(`\nLooking up ${maximoIds.length} assets by maximo_id…`)

  // If a site code was provided, resolve it to a site_id first so we only
  // match assets from that site. Without this filter, the same Maximo ID
  // can match assets from multiple sites (SY7, SY9x, SY1, CA1 etc.) and the
  // wrong test records end up in the output file.
  let siteIdFilter = null
  if (siteCode) {
    const { data: siteRow } = await supabase
      .from('sites')
      .select('id, name')
      .eq('code', siteCode)
      .maybeSingle()
    if (!siteRow) {
      console.error(`Site with code "${siteCode}" not found in EQ Service.`)
      process.exit(1)
    }
    siteIdFilter = siteRow.id
    console.log(`  Site filter: ${siteRow.name} (${siteCode})`)
  } else {
    console.warn('  ⚠  No site code provided — results may include assets from multiple sites.')
    console.warn('     Re-run with a site code to scope correctly, e.g.: node tools/maximo-acb-import.mjs <file> output.xlsx SY7')
  }

  let assetQuery = supabase
    .from('assets')
    .select('id, name, maximo_id, site_id')
    .in('maximo_id', maximoIds)
    .eq('is_active', true)

  if (siteIdFilter) assetQuery = assetQuery.eq('site_id', siteIdFilter)

  const { data: assets, error: assetErr } = await assetQuery

  if (assetErr) {
    console.error('Asset lookup failed:', assetErr.message)
    process.exit(1)
  }

  const assetByMaximoId = Object.fromEntries((assets ?? []).map(a => [a.maximo_id, a]))
  const matched = assets?.length ?? 0
  const unmatched = maximoIds.filter(id => !assetByMaximoId[id])
  console.log(`Matched: ${matched}  |  Unmatched: ${unmatched.length}`)
  if (unmatched.length > 0) {
    console.warn('Unmatched maximo_ids (not found in EQ Service):')
    unmatched.forEach(id => console.warn(`  • ${id}`))
  }

  // ── Look up existing acb_tests rows ──────────────────────────────────────
  const assetIds = (assets ?? []).map(a => a.id)
  const { data: existingTests } = await supabase
    .from('acb_tests')
    .select('id, asset_id, step1_status')
    .in('asset_id', assetIds)
    .eq('is_active', true)

  const testByAssetId = Object.fromEntries((existingTests ?? []).map(t => [t.asset_id, t]))

  // ── Determine tenant_id (all SY7 assets share one tenant) ─────────────────
  // Read from first matched asset's site.
  let tenantId = null
  if (assets && assets.length > 0) {
    const siteId = assets[0].site_id
    const { data: site } = await supabase
      .from('sites')
      .select('tenant_id')
      .eq('id', siteId)
      .single()
    tenantId = site?.tenant_id ?? null
  }
  if (!tenantId) {
    console.error('Could not resolve tenant_id — aborting.')
    process.exit(1)
  }
  console.log(`Tenant: ${tenantId}`)

  // ── Create missing acb_tests rows ─────────────────────────────────────────
  const toCreate = assetIds.filter(id => !testByAssetId[id]).map(assetId => {
    const asset = assets.find(a => a.id === assetId)
    return {
      tenant_id:      tenantId,
      asset_id:       assetId,
      site_id:        asset.site_id,
      test_date:      new Date().toISOString().split('T')[0],
      test_type:      'Initial',
      overall_result: 'Pending',
      step1_status:   'pending',
      step2_status:   'pending',
      step3_status:   'pending',
      is_active:      true,
    }
  })

  if (toCreate.length > 0) {
    console.log(`\nCreating ${toCreate.length} new acb_tests rows…`)
    const { data: created, error: createErr } = await supabase
      .from('acb_tests')
      .insert(toCreate)
      .select('id, asset_id')

    if (createErr) {
      console.error('Failed to create acb_tests rows:', createErr.message)
      process.exit(1)
    }
    console.log(`Created ${created?.length ?? 0} rows`)
    ;(created ?? []).forEach(t => { testByAssetId[t.asset_id] = t })
  } else {
    console.log('All matched assets already have acb_tests rows')
  }

  // ── Build EQ import rows ──────────────────────────────────────────────────
  console.log('\nBuilding import rows…')
  const importRows = []
  const nameChanges = []

  for (const { rowNum, row, assetId } of maximoRows) {
    const asset = assetByMaximoId[assetId]
    if (!asset) continue  // unmatched — skip

    const test = testByAssetId[asset.id]
    if (!test) continue  // shouldn't happen

    const rawModel     = cell(row, COL.MODEL_NO)
    const rawTripModel = cell(row, COL.TRIP_MODEL)
    const tripModel    = cleanProtection(rawTripModel)
    const protection   = tripModel !== null

    const rawLtIr   = cleanProtection(cell(row, COL.LONG_TIME_PICKUP))
    const rawLtTr   = cleanProtection(cell(row, COL.LONG_TIME_DELAY))
    const rawStIsd  = cleanProtection(cell(row, COL.SHORT_TIME_PICKUP))
    const rawStTsd  = cleanProtection(cell(row, COL.SHORT_TIME_DELAY))
    const rawInstIi = cleanProtection(cell(row, COL.INST_PICKUP))
    const rawEfIg   = cleanProtection(cell(row, COL.GROUND_FAULT_PICKUP))
    const rawEfTg   = cleanProtection(cell(row, COL.GROUND_FAULT_DELAY))

    const maximoDesc = cell(row, COL.ASSET_DESC)
    if (maximoDesc && asset.name !== maximoDesc) {
      nameChanges.push({ maximo_id: assetId, eq_name: asset.name, maximo_name: maximoDesc })
    }

    importRows.push([
      asset.id,                                        // Asset ID
      test.id,                                         // Test ID
      asset.name,                                      // Asset Name
      cell(row, COL.MANUFACTURER) ?? null,             // Brand
      mapBreakerType(cell(row, COL.BREAKER_CONSTRUCTION)),  // Breaker Type
      maximoDesc ?? null,                              // Name / Location / CB
      cell(row, COL.SERIAL_NO) ?? null,                // Serial Number
      extractPerformanceLevel(rawModel),               // Performance Level
      protection ? 'Yes' : 'No',                       // Protection Unit
      tripModel ?? null,                               // Trip Unit Model
      null,                                            // Poles (not in Maximo)
      cell(row, COL.AMP_FRAME)
        ? String(cell(row, COL.AMP_FRAME)).replace(/[^0-9]/g, '') || null
        : null,                                        // Breaker Rating (IN)
      mapMount(cell(row, COL.BREAKER_MOUNT)),          // Fixed / Withdrawable
      protection ? (rawLtIr ?? null)   : null,         // Long Time Ir
      protection ? (rawLtTr ?? null)   : null,         // Long Time Delay tr
      protection ? (rawStIsd ?? null)  : null,         // Short Time Isd
      protection ? (rawStTsd ?? null)  : null,         // Short Time Delay tsd
      protection ? (rawInstIi ?? null) : null,         // Instantaneous Ii
      protection ? (rawEfIg ?? null)   : null,         // Earth Fault Ig
      protection ? (rawEfTg ?? null)   : null,         // Earth Fault Delay tg
      null,                                            // Earth Leakage (not in Maximo)
      null,                                            // Earth Leakage Delay (not in Maximo)
      'Not installed',                                 // Motor Charge
      'Not installed',                                 // Shunt Trip (MX1)
      'Not installed',                                 // Shunt Close (XF)
      'Not installed',                                 // Undervoltage (MN)
      'Not installed',                                 // 2nd Shunt Trip (MX2)
    ])
  }

  console.log(`Built ${importRows.length} import rows`)

  // ── Name change report ────────────────────────────────────────────────────
  if (nameChanges.length > 0) {
    console.log(`\n⚠  ${nameChanges.length} assets have different names between EQ Service and Maximo:`)
    console.log('   (The import uses the EQ Service name — update manually if needed)')
    nameChanges.forEach(c => {
      console.log(`   Maximo ${c.maximo_id}`)
      console.log(`     EQ Service: ${c.eq_name}`)
      console.log(`     Maximo:     ${c.maximo_name}`)
    })
  }

  // ── Write output XLSX ─────────────────────────────────────────────────────
  const outWb = new Workbook()
  const ws = outWb.addWorksheet('ACB Import')

  ws.addRow(EQ_HEADERS)

  // Style header row
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFD9E8F5' },
  }

  // Hide UUID columns (A=Asset ID, B=Test ID)
  ws.getColumn(1).hidden = true
  ws.getColumn(2).hidden = true

  // Set column widths
  const widths = [12,12,22,16,16,22,16,16,14,16,10,16,18,14,16,14,16,16,14,16,14,16,14,14,14,16,16]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  importRows.forEach(r => ws.addRow(r))

  await outWb.xlsx.writeFile(outputPath)

  console.log(`\n✅ Output written to: ${outputPath}`)
  console.log(`   ${importRows.length} rows ready for upload`)
  console.log('\nNext step: Go to EQ Service → Testing → ACB → Upload Collection Data')
  console.log('and upload this file. The existing import will populate Step 1 for each asset.')
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
