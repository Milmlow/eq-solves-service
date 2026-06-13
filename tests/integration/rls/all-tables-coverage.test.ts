/**
 * RLS — whole-schema coverage (auto-discovered, structural).
 *
 * This is the future-proof net. It does NOT seed data or sign in as a user;
 * it reads the live RLS posture of the public schema via the read-only
 * `rls_introspection()` function (migration 0126) and asserts the invariants
 * that must hold for EVERY table — including tables added by future migrations
 * the author of this test never saw.
 *
 * The four invariants (mirrors AGENTS.md "Database & RLS"):
 *   1. Every public table has RLS enabled.
 *   2. No tenant-scoped table (has a tenant_id column) carries a permissive
 *      `USING (true)` / `WITH CHECK (true)` policy — the silent-widening
 *      failure mode. This is the single most important structural check.
 *   3. Every tenant-scoped table has at least one policy, OR is a documented
 *      service-role-only table (RLS on + zero policies = deny-all to
 *      authenticated/anon, only service_role bypasses).
 *   4. Any NON-tenant table that carries a permissive `true` policy must be a
 *      documented public surface. Catches a new table accidentally exposed to
 *      anon/authenticated.
 *
 * When invariant 1 or 2 fails: treat as P0. A new table shipped without RLS,
 * or a policy was widened to `true` on tenant data.
 *
 * When invariant 3 or 4 fails on a NEW table: either add the missing
 * tenant-scoped policy, or — if the table is intentionally service-role-only
 * or intentionally public — add it to the documented allow-list below WITH a
 * one-line justification. Never widen a policy to silence the test.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { adminClient } from '../helpers/db'

// ── Documented allow-lists ─────────────────────────────────────────────────
// Keep these in sync with scripts/audit-rls.ts — both read the same posture.

// pg internals / extension tables that are out of RLS scope.
const EXCLUDED_TABLES = new Set<string>([
  'spatial_ref_sys', // PostGIS metadata, owned by the extension
])

// RLS on + zero policies, on purpose: written only by service_role (triggers,
// cron, sync) and never read by a tenant session. Deny-all is the correct
// posture — adding a permissive policy here would be the bug.
const SERVICE_ROLE_ONLY = new Set<string>([
  'canonical_outbox',        // canonical sync queue — drained by cron (service_role)
  'context_proposals',       // context-system proposals — service_role writes
  'tenant_slug_tombstones',  // slug-reuse guard — trigger-maintained
])

// Tables intentionally exposed with a permissive `true` policy. Each is a
// public, non-tenant-scoped surface. NEW additions need a justification here.
const PUBLIC_TRUE_ALLOWED = new Set<string>([
  'briefs',          // public intake form (anon submit)
  'estimates',       // public estimate links
  'estimate_events', // public estimate interaction log
  '_meta',           // build/attribution metadata, read-only public
  // NOTE: context_files was here while it had an anon "Public read" policy.
  // Migration 0128 dropped that; its only remaining policy is service_role-only
  // (auto-skipped by isServiceRoleOnly below), so it no longer needs a waiver.
])

interface IntrospectionTable {
  table_name: string
  rls_enabled: boolean
  has_tenant_id: boolean
}
interface IntrospectionPolicy {
  table_name: string
  policy: string
  cmd: string
  roles: string[]
  qual: string | null
  with_check: string | null
}
interface Introspection {
  tables: IntrospectionTable[]
  policies: IntrospectionPolicy[]
}

function isPermissiveTrue(p: IntrospectionPolicy): boolean {
  return p.qual === 'true' || p.with_check === 'true'
}

// A `true` predicate scoped to service_role only is always safe: service_role
// bypasses RLS regardless, so the policy grants it nothing it didn't already
// have, and it is never reachable by anon/authenticated. These are not leaks.
function isServiceRoleOnly(p: IntrospectionPolicy): boolean {
  return p.roles.length === 1 && p.roles[0] === 'service_role'
}

describe('RLS — whole-schema coverage (auto-discovered)', () => {
  let intro: Introspection
  let tables: IntrospectionTable[]
  let policiesByTable: Map<string, IntrospectionPolicy[]>

  beforeAll(async () => {
    const admin = adminClient()
    const { data, error } = await admin.rpc('rls_introspection')
    if (error) {
      throw new Error(
        `rls_introspection() RPC failed: ${error.message}. ` +
          'Is migration 0126 applied to the local DB? Run `supabase db reset` / `supabase migration up`.',
      )
    }
    intro = data as unknown as Introspection
    tables = intro.tables.filter((t) => !EXCLUDED_TABLES.has(t.table_name))
    policiesByTable = new Map()
    for (const p of intro.policies) {
      const arr = policiesByTable.get(p.table_name) ?? []
      arr.push(p)
      policiesByTable.set(p.table_name, arr)
    }
  })

  it('discovers a non-trivial set of public tables (RPC sanity)', () => {
    // Guards against the RPC silently returning [] and every check vacuously
    // passing. The app has dozens of public tables — anything under ~20 means
    // introspection is broken, not that the schema shrank.
    expect(tables.length).toBeGreaterThan(20)
  })

  it('invariant 1 — every public table has RLS enabled', () => {
    const offenders = tables.filter((t) => !t.rls_enabled).map((t) => t.table_name)
    expect(
      offenders,
      `Tables with RLS DISABLED (add ENABLE ROW LEVEL SECURITY + a tenant policy): ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('invariant 2 — no tenant-scoped table has a permissive true policy', () => {
    const offenders: string[] = []
    for (const t of tables) {
      if (!t.has_tenant_id) continue
      const pols = policiesByTable.get(t.table_name) ?? []
      for (const p of pols) {
        if (isPermissiveTrue(p) && !isServiceRoleOnly(p)) {
          offenders.push(`${t.table_name}.${p.policy} (${p.cmd}, roles=${p.roles.join('|')})`)
        }
      }
    }
    expect(
      offenders,
      `Tenant-scoped tables with USING(true)/WITH CHECK(true) — a cross-tenant leak risk: ${offenders.join('; ')}`,
    ).toEqual([])
  })

  it('invariant 3 — every tenant-scoped table has a policy (or is documented service-role-only)', () => {
    const offenders: string[] = []
    for (const t of tables) {
      if (!t.has_tenant_id) continue
      if (SERVICE_ROLE_ONLY.has(t.table_name)) continue
      const pols = policiesByTable.get(t.table_name) ?? []
      if (pols.length === 0) offenders.push(t.table_name)
    }
    expect(
      offenders,
      `Tenant-scoped tables with RLS on but ZERO policies (unreachable to tenants — add a policy or document in SERVICE_ROLE_ONLY): ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('invariant 4 — only documented public tables carry a permissive true policy', () => {
    const offenders: string[] = []
    for (const t of tables) {
      if (t.has_tenant_id) continue // covered by invariant 2
      if (PUBLIC_TRUE_ALLOWED.has(t.table_name)) continue
      const pols = policiesByTable.get(t.table_name) ?? []
      for (const p of pols) {
        if (isPermissiveTrue(p) && !isServiceRoleOnly(p)) {
          offenders.push(`${t.table_name}.${p.policy} (${p.cmd}, roles=${p.roles.join('|')})`)
        }
      }
    }
    expect(
      offenders,
      `Non-tenant tables newly exposed with USING(true)/WITH CHECK(true) — confirm intent and add to PUBLIC_TRUE_ALLOWED with justification, or scope the policy: ${offenders.join('; ')}`,
    ).toEqual([])
  })
})
