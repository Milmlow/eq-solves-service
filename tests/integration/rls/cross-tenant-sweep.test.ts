/**
 * RLS — cross-tenant enforcement sweep (auto-discovered).
 *
 * The hand-written isolation tests (customers, maintenance_checks, audit_logs)
 * prove the attack shapes in depth on the highest-value tables. This sweep
 * proves the SAME read-isolation holds on EVERY tenant-scoped table — including
 * tables a future migration adds — without anyone having to remember to write a
 * new test file.
 *
 * Method:
 *   1. Seed two real tenants (A and B) with real signed-in users.
 *   2. Best-effort seed "bait" rows into Tenant A across the core FK chain
 *      (customer → site → job_plan → maintenance_check, plus audit_log, asset,
 *      defect, instrument). Best-effort: if a table's insert shape has drifted,
 *      that table simply isn't baited — it is still swept for leaks. Seeding is
 *      never the thing that fails this test.
 *   3. Discover every tenant-scoped table via rls_introspection() (migration
 *      0126) and assert, for each:
 *        • As User B (a different tenant): zero rows belonging to Tenant A are
 *          visible, and the query does not error (a thrown policy = a finding).
 *        • As anon (no JWT): zero rows visible at all.
 *
 * Coverage honesty: the baited tables get a true cross-tenant leak test (real
 * Tenant-A rows that must stay invisible). Unbaited tables get a "policy does
 * not error and exposes no ambient cross-tenant data" check; their structural
 * guarantee (RLS on, no permissive `true`) is asserted by
 * all-tables-coverage.test.ts. The two files together cover the whole schema.
 *
 * Any failure here is a P0 cross-tenant read leak.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  seedTenantWithAdmin,
  signedInClient,
  anonClient,
  adminClient,
  cleanupTenant,
  type SeededTenant,
} from '../helpers/db'

const SERVICE_ROLE_ONLY = new Set<string>([
  'canonical_outbox',
  'context_proposals',
  'tenant_slug_tombstones',
])

interface IntrospectionTable {
  table_name: string
  rls_enabled: boolean
  has_tenant_id: boolean
}

describe('RLS — cross-tenant enforcement sweep (auto-discovered)', () => {
  let tenantA: SeededTenant
  let tenantB: SeededTenant
  let tenantTables: string[] = []
  const baited = new Set<string>()

  beforeAll(async () => {
    tenantA = await seedTenantWithAdmin('sweep-a')
    tenantB = await seedTenantWithAdmin('sweep-b')
    const admin = adminClient()

    // Best-effort bait. Each helper inserts a Tenant-A row and records the
    // table as baited; a failure (e.g. drifted columns) is swallowed so the
    // sweep still runs. The shapes mirror the hand-written isolation tests.
    const seed = async (table: string, row: Record<string, unknown>): Promise<string | null> => {
      const { data, error } = await admin.from(table).insert(row).select('id').single()
      if (error || !data) return null
      baited.add(table)
      return (data as { id: string }).id
    }

    const customerId = await seed('customers', {
      tenant_id: tenantA.tenantId,
      name: 'Sweep Cust A',
      is_active: true,
    })
    const siteId = customerId
      ? await seed('sites', {
          tenant_id: tenantA.tenantId,
          customer_id: customerId,
          name: 'Sweep Site A',
          is_active: true,
        })
      : null
    const jobPlanId = siteId
      ? await seed('job_plans', {
          tenant_id: tenantA.tenantId,
          site_id: siteId,
          name: 'Sweep Plan A',
          code: `SWEEP-A-${Date.now()}`,
          frequency: 'annual',
          is_active: true,
        })
      : null
    if (siteId && jobPlanId) {
      await seed('maintenance_checks', {
        tenant_id: tenantA.tenantId,
        site_id: siteId,
        job_plan_id: jobPlanId,
        due_date: '2026-12-01',
        status: 'scheduled',
        kind: 'maintenance',
      })
    }
    if (siteId) {
      await seed('assets', {
        tenant_id: tenantA.tenantId,
        site_id: siteId,
        name: 'Sweep Asset A',
        asset_type: 'switchboard',
        is_active: true,
      })
      await seed('defects', {
        tenant_id: tenantA.tenantId,
        site_id: siteId,
        title: 'Sweep Defect A',
        description: 'tenant-A-only defect',
        severity: 'medium',
        status: 'open',
        raised_date: '2026-06-01',
      })
    }
    await seed('audit_logs', {
      tenant_id: tenantA.tenantId,
      user_id: tenantA.user.id,
      action: 'create',
      entity_type: 'maintenance_check',
      entity_id: null,
      summary: 'sweep: tenant-A-only audit entry',
      metadata: { secret: 'tenantA' },
    })
    await seed('instruments', {
      tenant_id: tenantA.tenantId,
      name: 'Sweep Instrument A',
      is_active: true,
    })

    // Discover every tenant-scoped table. Exclude documented service-role-only
    // tables (deny-all; not part of the tenant-readable surface).
    const { data, error } = await admin.rpc('rls_introspection')
    if (error) {
      throw new Error(
        `rls_introspection() RPC failed: ${error.message}. Is migration 0126 applied locally?`,
      )
    }
    const intro = data as unknown as { tables: IntrospectionTable[] }
    tenantTables = intro.tables
      .filter((t) => t.has_tenant_id && !SERVICE_ROLE_ONLY.has(t.table_name))
      .map((t) => t.table_name)
      .sort()
  }, 60_000)

  afterAll(async () => {
    if (tenantA) await cleanupTenant(tenantA)
    if (tenantB) await cleanupTenant(tenantB)
  })

  it('seeded bait into the core FK chain (sanity)', () => {
    // If we baited nothing, the leak assertions below are vacuous. Require the
    // load-bearing tables at minimum.
    expect(baited.has('customers')).toBe(true)
    expect(baited.has('sites')).toBe(true)
    expect(baited.has('maintenance_checks')).toBe(true)
    expect(baited.has('audit_logs')).toBe(true)
  })

  it('User B sees ZERO Tenant-A rows across every tenant-scoped table', async () => {
    const clientB = await signedInClient(tenantB.user.email, tenantB.user.password)
    const leaks: string[] = []
    const errors: string[] = []

    for (const table of tenantTables) {
      const { data, error } = await clientB.from(table).select('tenant_id').limit(1000)
      if (error) {
        errors.push(`${table}: ${error.message}`)
        continue
      }
      const leaked = (data ?? []).filter(
        (r) => (r as { tenant_id: string }).tenant_id === tenantA.tenantId,
      )
      if (leaked.length > 0) {
        leaks.push(`${table} (${leaked.length} Tenant-A row(s) visible to Tenant B)`)
      }
    }

    expect(leaks, `CROSS-TENANT READ LEAK — Tenant B can see Tenant A rows in: ${leaks.join('; ')}`).toEqual([])
    expect(errors, `Policy errors while sweeping as Tenant B (a broken/throwing policy is itself a finding): ${errors.join('; ')}`).toEqual([])
  }, 60_000)

  it('anonymous (no JWT) sees ZERO rows across every tenant-scoped table', async () => {
    const anon = anonClient()
    const exposed: string[] = []

    for (const table of tenantTables) {
      const { data, error } = await anon.from(table).select('tenant_id').limit(1)
      // anon has no tenant membership — every tenant-scoped policy must yield
      // zero rows. An error is acceptable here (some deny by erroring), a
      // returned row is NOT.
      if (!error && (data?.length ?? 0) > 0) {
        exposed.push(`${table} (${data!.length} row(s) visible to anon)`)
      }
    }

    expect(exposed, `ANON DATA EXPOSURE — unauthenticated client can read: ${exposed.join('; ')}`).toEqual([])
  }, 60_000)
})
