/**
 * Trigger regression — auto-defect creation from failed items/readings.
 *
 * Guards the bug fixed in migration 0120 (found 2026-06-06, pre-SKS-go-live):
 * the four auto-defect trigger functions used a BARE `ON CONFLICT (col)` that
 * cannot infer the PARTIAL unique indexes created in 0061/0062. Every
 * transition to fail therefore raised Postgres 42P10 and crashed the save —
 * the core on-site workflow. A unit test could never catch it because the bug
 * lived entirely in a DB trigger; only a real-Postgres test exercises the
 * ON CONFLICT / partial-index interaction.
 *
 * These tests would all FAIL (insert errors with 42P10) against the pre-0120
 * functions, and PASS once the predicate is restated. If anyone ever drops the
 * `WHERE <col> IS NOT NULL` from a conflict target again, this lights up.
 *
 * Covers all four paths plus the ON CONFLICT DO UPDATE branch (re-fail after
 * un-fail), which is the exact code path that needed the predicate.
 *
 * Uses adminClient throughout: we are testing a SECURITY DEFINER trigger, not
 * RLS, so service-role inserts are the correct, simplest way to drive it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedTenantWithAdmin, adminClient, cleanupTenant, type SeededTenant } from '../helpers/db'

describe('Trigger regression — auto-defect from failed items/readings (migration 0120)', () => {
  let tenant: SeededTenant
  let siteId: string
  let assetId: string
  let checkId: string
  let checkAssetId: string

  beforeAll(async () => {
    tenant = await seedTenantWithAdmin('autodefect')
    const admin = adminClient()

    const { data: customer, error: cErr } = await admin
      .from('customers')
      .insert({ tenant_id: tenant.tenantId, name: 'Cust AD', is_active: true })
      .select('id').single()
    if (cErr || !customer) throw new Error(`seed customer failed: ${cErr?.message ?? 'no row'}`)

    const { data: site, error: sErr } = await admin
      .from('sites')
      .insert({ tenant_id: tenant.tenantId, customer_id: customer.id, name: 'Site AD', is_active: true })
      .select('id').single()
    if (sErr || !site) throw new Error(`seed site failed: ${sErr?.message ?? 'no row'}`)
    siteId = site.id

    const { data: asset, error: aErr } = await admin
      .from('assets')
      .insert({ tenant_id: tenant.tenantId, site_id: siteId, name: 'Asset AD', asset_type: 'Switchboard', is_active: true })
      .select('id').single()
    if (aErr || !asset) throw new Error(`seed asset failed: ${aErr?.message ?? 'no row'}`)
    assetId = asset.id

    const { data: check, error: kErr } = await admin
      .from('maintenance_checks')
      .insert({ tenant_id: tenant.tenantId, site_id: siteId, due_date: '2026-12-01', status: 'in_progress', kind: 'maintenance' })
      .select('id').single()
    if (kErr || !check) throw new Error(`seed check failed: ${kErr?.message ?? 'no row'}`)
    checkId = check.id

    const { data: ca, error: caErr } = await admin
      .from('check_assets')
      .insert({ tenant_id: tenant.tenantId, check_id: checkId, asset_id: assetId, status: 'in_progress' })
      .select('id').single()
    if (caErr || !ca) throw new Error(`seed check_asset failed: ${caErr?.message ?? 'no row'}`)
    checkAssetId = ca.id
  })

  afterAll(async () => {
    if (tenant) await cleanupTenant(tenant)
  })

  it('failing a maintenance_check_item auto-creates a defect (no 42P10)', async () => {
    const admin = adminClient()
    const { data: item, error } = await admin
      .from('maintenance_check_items')
      .insert({
        tenant_id: tenant.tenantId, check_id: checkId, check_asset_id: checkAssetId, asset_id: assetId,
        description: 'Inspect indicator lamps', sort_order: 10, is_required: true, result: 'fail',
      })
      .select('id').single()

    // Pre-0120 this insert errored with 42P10 — the assertion that matters most.
    expect(error).toBeNull()
    expect(item).not.toBeNull()

    const { data: defect } = await admin
      .from('defects')
      .select('id, source, severity, status')
      .eq('source_check_item_id', item!.id)
      .single()

    expect(defect?.source).toBe('auto_check_item')
    expect(defect?.status).toBe('open')
  })

  it('un-failing then re-failing an item exercises ON CONFLICT DO UPDATE without duplicating', async () => {
    const admin = adminClient()
    const { data: item } = await admin
      .from('maintenance_check_items')
      .insert({
        tenant_id: tenant.tenantId, check_id: checkId, check_asset_id: checkAssetId, asset_id: assetId,
        description: 'Test e-stop function', sort_order: 20, is_required: true, result: 'fail',
      })
      .select('id').single()

    // Un-fail → auto-resolve the defect.
    await admin.from('maintenance_check_items').update({ result: 'pass' }).eq('id', item!.id)
    // Re-fail → this hits the ON CONFLICT (source_check_item_id) DO UPDATE path,
    // the exact branch that required the partial-index predicate.
    const { error: refailErr } = await admin
      .from('maintenance_check_items').update({ result: 'fail' }).eq('id', item!.id)
    expect(refailErr).toBeNull()

    const { data: defects } = await admin
      .from('defects')
      .select('id, status')
      .eq('source_check_item_id', item!.id)

    // Exactly one defect (re-opened), never duplicated.
    expect(defects?.length).toBe(1)
    expect(defects?.[0]?.status).toBe('open')
  })

  it('failing an ACB reading auto-creates a high-severity defect', async () => {
    const admin = adminClient()
    const { data: test } = await admin
      .from('acb_tests')
      .insert({ tenant_id: tenant.tenantId, asset_id: assetId, site_id: siteId, test_date: '2026-06-06' })
      .select('id').single()
    const { data: reading, error } = await admin
      .from('acb_test_readings')
      .insert({ acb_test_id: test!.id, tenant_id: tenant.tenantId, label: 'Insulation Resistance', value: '1.2', is_pass: false })
      .select('id').single()

    expect(error).toBeNull()
    const { data: defect } = await admin
      .from('defects').select('source, severity').eq('source_acb_reading_id', reading!.id).single()
    expect(defect?.source).toBe('auto_acb_test')
    expect(defect?.severity).toBe('high') // 'insulation' → high via fn_severity_from_reading_label
  })

  it('failing an NSX reading auto-creates a defect', async () => {
    const admin = adminClient()
    const { data: test } = await admin
      .from('nsx_tests')
      .insert({ tenant_id: tenant.tenantId, asset_id: assetId, site_id: siteId, test_date: '2026-06-06' })
      .select('id').single()
    const { data: reading, error } = await admin
      .from('nsx_test_readings')
      .insert({ nsx_test_id: test!.id, tenant_id: tenant.tenantId, label: 'Operation check', value: 'fail', is_pass: false })
      .select('id').single()

    expect(error).toBeNull()
    const { data: defect } = await admin
      .from('defects').select('source').eq('source_nsx_reading_id', reading!.id).single()
    expect(defect?.source).toBe('auto_nsx_test')
  })

  it('failing a test_record reading auto-creates a defect', async () => {
    const admin = adminClient()
    const { data: rec } = await admin
      .from('test_records')
      .insert({ tenant_id: tenant.tenantId, asset_id: assetId, site_id: siteId, test_type: 'general', test_date: '2026-06-06' })
      .select('id').single()
    const { data: reading, error } = await admin
      .from('test_record_readings')
      .insert({ test_record_id: rec!.id, tenant_id: tenant.tenantId, label: 'Visual inspection', pass: false })
      .select('id').single()

    expect(error).toBeNull()
    const { data: defect } = await admin
      .from('defects').select('source, severity').eq('source_test_record_reading_id', reading!.id).single()
    expect(defect?.source).toBe('auto_general_test')
    expect(defect?.severity).toBe('low') // 'visual' / 'inspection' → low
  })
})
