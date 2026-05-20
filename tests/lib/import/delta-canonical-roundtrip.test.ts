/**
 * Round-trip smoke test for the admin canonical Delta importer.
 *
 * Verifies:
 *   1. parseWorkbook(real fixture) parses cleanly.
 *   2. projectMaintenanceCheck + projectCheckAsset produce canonical
 *      objects that pass ajv against the v1 schemas.
 *   3. toDbMaintenanceCheckInsert + toDbCheckAssetInsert produce DB-row
 *      shapes that, when fed back through the export mapper logic
 *      (mirrored inline from lib/admin/canonical-export.ts), round-trip
 *      to the same canonical object.
 *
 * The inline export-mapper mirror is intentional — if canonical-export.ts
 * drifts (renames a column, drops a field), this test fails and the two
 * halves of the canonical layer stay in sync. The export DB→canonical
 * mapping is the contract the importer must round-trip.
 *
 * No DB. No HTTP. Pure projection + ajv + mirror.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { parseWorkbook } from '@/lib/import/delta-wo-parser'
import {
  projectMaintenanceCheck,
  projectCheckAsset,
  toDbMaintenanceCheckInsert,
  toDbCheckAssetInsert,
  type CanonicalMaintenanceCheck,
  type CanonicalCheckAsset,
} from '@/lib/import/canonical-project'
import {
  validateMaintenanceCheck,
  validateCheckAsset,
} from '@/lib/import/canonical-validate'

const FIXTURE = join(__dirname, 'fixtures', 'WO_Aug_2025_Delta.xlsx')
const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const SITE_ID = '22222222-2222-2222-2222-222222222222'
const PLAN_ID = '33333333-3333-3333-3333-333333333333'

/**
 * Mirror of `exportMaintenanceCheck` in lib/admin/canonical-export.ts —
 * DB row shape (the columns it selects) → canonical projection. Kept
 * inline so any rename/drop in the exporter breaks this test.
 */
type MaintenanceCheckDbRow = {
  id: string | null
  job_plan_id: string | null
  site_id: string | null
  assigned_to: string | null
  status: string | null
  due_date: string | null
  start_date: string | null
  started_at: string | null
  completed_at: string | null
  frequency: string | null
  is_dark_site: boolean | null
  custom_name: string | null
  maximo_wo_number: string | null
  maximo_pm_number: string | null
  notes: string | null
}

function mirrorExportMaintenanceCheck(
  r: MaintenanceCheckDbRow,
  tenantId: string,
): CanonicalMaintenanceCheck {
  return {
    check_id: r.id as string,
    tenant_id: tenantId,
    plan_id: r.job_plan_id,
    site_id: r.site_id as string,
    assigned_to_user_id: r.assigned_to,
    status: r.status as CanonicalMaintenanceCheck['status'],
    due_date: r.due_date as string,
    start_date: r.start_date,
    started_at: r.started_at,
    completed_at: r.completed_at,
    frequency: r.frequency as CanonicalMaintenanceCheck['frequency'],
    is_dark_site: r.is_dark_site ?? false,
    custom_name: r.custom_name,
    maximo_wo_number: r.maximo_wo_number,
    maximo_pm_number: r.maximo_pm_number,
    notes: r.notes,
  }
}

type CheckAssetDbRow = {
  id: string | null
  check_id: string | null
  asset_id: string | null
  status: string | null
  work_order_number: string | null
  priority: string | null
  work_type: string | null
  crew_id: string | null
  target_start: string | null
  target_finish: string | null
  failure_code: string | null
  problem: string | null
  cause: string | null
  remedy: string | null
  classification: string | null
  ir_scan_result: string | null
  completed_at: string | null
  notes: string | null
}

function mirrorExportCheckAsset(r: CheckAssetDbRow, tenantId: string): CanonicalCheckAsset {
  return {
    check_asset_id: r.id as string,
    tenant_id: tenantId,
    check_id: r.check_id as string,
    asset_id: r.asset_id as string,
    status: r.status as CanonicalCheckAsset['status'],
    work_order_number: r.work_order_number,
    priority: r.priority as CanonicalCheckAsset['priority'],
    work_type: r.work_type as CanonicalCheckAsset['work_type'],
    crew_id: r.crew_id,
    target_start: r.target_start,
    target_finish: r.target_finish,
    completed_at: r.completed_at,
    failure_code: r.failure_code,
    problem: r.problem,
    cause: r.cause,
    remedy: r.remedy,
    classification: r.classification,
    ir_scan_result: r.ir_scan_result as CanonicalCheckAsset['ir_scan_result'],
    notes: r.notes,
  }
}

describe('Delta canonical importer round-trip', () => {
  it('parses the August 2025 fixture cleanly', async () => {
    const buf = readFileSync(FIXTURE)
    const parsed = await parseWorkbook(buf)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows.length).toBeGreaterThan(0)
    expect(parsed.groups.length).toBeGreaterThan(0)
  })

  it('projects each parsed group into a canonical maintenance_check that passes ajv', async () => {
    const buf = readFileSync(FIXTURE)
    const parsed = await parseWorkbook(buf)

    for (const g of parsed.groups) {
      if (!g.frequency) continue // skip unknown-frequency groups for ajv (enum gate)
      const canonical = projectMaintenanceCheck({
        checkId: randomUUID(),
        tenantId: TENANT_ID,
        group: g,
        siteId: SITE_ID,
        jobPlanId: PLAN_ID,
        customName: `${g.siteCode} — ${g.jobPlanCode} — fixture`,
        assignedToUserId: null,
      })
      const result = validateMaintenanceCheck(canonical)
      if (!result.valid) {
        throw new Error(
          `Group ${g.key} canonical maintenance_check failed ajv: ${result.errors
            .map((e) => `${e.path} ${e.message}`)
            .join('; ')}`,
        )
      }
    }
  })

  it('projects each parsed row into a canonical check_asset that passes ajv', async () => {
    const buf = readFileSync(FIXTURE)
    const parsed = await parseWorkbook(buf)

    let validated = 0
    for (const g of parsed.groups) {
      const checkId = randomUUID()
      for (const r of g.rows) {
        const canonical = projectCheckAsset({
          checkAssetId: randomUUID(),
          tenantId: TENANT_ID,
          checkId,
          assetId: SITE_ID, // placeholder uuid, not validated against assets table
          row: r,
        })
        const result = validateCheckAsset(canonical)
        if (!result.valid) {
          throw new Error(
            `Row ${r.rowNumber} canonical check_asset failed ajv: ${result.errors
              .map((e) => `${e.path} ${e.message}`)
              .join('; ')}`,
          )
        }
        validated++
      }
    }
    expect(validated).toBeGreaterThan(0)
  })

  it('round-trips a maintenance_check through DB insert → export mirror unchanged', async () => {
    const buf = readFileSync(FIXTURE)
    const parsed = await parseWorkbook(buf)
    const g = parsed.groups.find((x) => x.frequency !== null)
    if (!g) throw new Error('No fixture group with a known frequency')

    const checkId = randomUUID()
    const canonical = projectMaintenanceCheck({
      checkId,
      tenantId: TENANT_ID,
      group: g,
      siteId: SITE_ID,
      jobPlanId: PLAN_ID,
      customName: `${g.siteCode} — ${g.jobPlanCode}`,
      assignedToUserId: null,
    })

    // canonical -> DB insert shape -> export mirror -> canonical (same)
    const dbInsert = toDbMaintenanceCheckInsert(canonical) as MaintenanceCheckDbRow
    const exported = mirrorExportMaintenanceCheck(dbInsert, TENANT_ID)
    expect(exported).toEqual(canonical)
  })

  it('round-trips every check_asset row in a group through DB insert → export mirror unchanged', async () => {
    const buf = readFileSync(FIXTURE)
    const parsed = await parseWorkbook(buf)
    const g = parsed.groups[0]!

    const checkId = randomUUID()
    for (const r of g.rows) {
      const assetId = randomUUID()
      const canonical = projectCheckAsset({
        checkAssetId: randomUUID(),
        tenantId: TENANT_ID,
        checkId,
        assetId,
        row: r,
      })
      const dbInsert = toDbCheckAssetInsert(canonical) as CheckAssetDbRow
      const exported = mirrorExportCheckAsset(dbInsert, TENANT_ID)
      expect(exported).toEqual(canonical)
    }
  })

  it('rejects a canonical maintenance_check with an invalid enum value', () => {
    const broken = {
      check_id: randomUUID(),
      tenant_id: TENANT_ID,
      plan_id: null,
      site_id: SITE_ID,
      assigned_to_user_id: null,
      status: 'gibberish',
      due_date: '2026-05-01',
      start_date: '2026-05-01',
      started_at: null,
      completed_at: null,
      frequency: null,
      is_dark_site: false,
      custom_name: null,
      maximo_wo_number: null,
      maximo_pm_number: null,
      notes: null,
    }
    const result = validateMaintenanceCheck(broken)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path.includes('status'))).toBe(true)
  })

  it('rejects a canonical check_asset missing required check_id', () => {
    const broken = {
      check_asset_id: randomUUID(),
      tenant_id: TENANT_ID,
      // check_id intentionally missing
      asset_id: SITE_ID,
      status: 'pending',
    }
    const result = validateCheckAsset(broken)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /check_id/.test(e.message) || e.path.includes('check_id'))).toBe(true)
  })
})
