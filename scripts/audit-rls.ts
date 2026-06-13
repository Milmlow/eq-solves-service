/**
 * RLS audit — `npx tsx scripts/audit-rls.ts` (or `npm run audit:rls`).
 *
 * Reads the live RLS posture of the public schema via the read-only
 * `rls_introspection()` function (migration 0126) and enforces four
 * invariants. Use it two ways:
 *
 *   • In CI / locally against the local Supabase, as a fast static gate.
 *   • As the LIVE read-only check: point NEXT_PUBLIC_SUPABASE_URL at the
 *     tenant project (urjhmkhbgaxrofurpbgc) with its service_role key and run
 *     this script. It mutates nothing — it only SELECTs catalog metadata via
 *     the RPC. The script prints the project ref it targeted so you can
 *     confirm it ran against the tenant Supabase and not somewhere else.
 *
 * Invariants (mirrors AGENTS.md and tests/integration/rls/all-tables-coverage):
 *   1. Every public table has RLS enabled.
 *   2. No tenant-scoped table carries a permissive USING(true)/WITH CHECK(true)
 *      policy.  [ERROR — cross-tenant leak risk]
 *   3. Every tenant-scoped table has a policy, or is documented service-role-only.
 *   4. Only documented public tables carry a permissive true policy.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Exit code: 0 = clean, 1 = at least one ERROR finding, 2 = script error.
 */

import { createClient } from '@supabase/supabase-js'

// ── Documented allow-lists — keep in sync with all-tables-coverage.test.ts ──
const EXCLUDED_TABLES = new Set<string>(['spatial_ref_sys'])

const SERVICE_ROLE_ONLY = new Set<string>([
  'canonical_outbox',
  'context_proposals',
  'tenant_slug_tombstones',
])

const PUBLIC_TRUE_ALLOWED = new Set<string>([
  'briefs',
  'estimates',
  'estimate_events',
  '_meta',
  // context_files: anon "Public read" dropped in migration 0128; its only
  // remaining policy is service_role-only (auto-skipped), so no waiver needed.
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

interface Finding {
  level: 'ERROR' | 'WARN'
  table: string
  message: string
}

function projectRef(url: string): string {
  const m = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i)
  if (m) return m[1]
  if (url.includes('127.0.0.1') || url.includes('localhost')) return 'local'
  return url
}

function isPermissiveTrue(p: IntrospectionPolicy): boolean {
  return p.qual === 'true' || p.with_check === 'true'
}

// A `true` predicate scoped to service_role only is always safe — service_role
// bypasses RLS regardless and the policy is unreachable by anon/authenticated.
function isServiceRoleOnly(p: IntrospectionPolicy): boolean {
  return p.roles.length === 1 && p.roles[0] === 'service_role'
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return 2
  }

  const ref = projectRef(url)
  console.log(`RLS audit — target project: ${ref}  (${url})`)
  console.log('')

  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await sb.rpc('rls_introspection')
  if (error) {
    console.error(`rls_introspection() RPC failed: ${error.message}`)
    console.error('Apply migration 0126 to this project, or run against a DB that has it.')
    return 2
  }

  const intro = data as unknown as Introspection
  const tables = intro.tables.filter((t) => !EXCLUDED_TABLES.has(t.table_name))
  const policiesByTable = new Map<string, IntrospectionPolicy[]>()
  for (const p of intro.policies) {
    const arr = policiesByTable.get(p.table_name) ?? []
    arr.push(p)
    policiesByTable.set(p.table_name, arr)
  }

  const findings: Finding[] = []

  // Invariant 1 — RLS enabled everywhere.
  for (const t of tables) {
    if (!t.rls_enabled) {
      findings.push({
        level: 'ERROR',
        table: t.table_name,
        message: 'RLS not enabled. Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` + a tenant policy.',
      })
    }
  }

  // Invariant 2 — no permissive true on tenant-scoped tables.
  for (const t of tables) {
    if (!t.has_tenant_id) continue
    for (const p of policiesByTable.get(t.table_name) ?? []) {
      if (isPermissiveTrue(p) && !isServiceRoleOnly(p)) {
        findings.push({
          level: 'ERROR',
          table: t.table_name,
          message: `Permissive policy "${p.policy}" (${p.cmd}, roles=${p.roles.join('|')}) uses USING/WITH CHECK (true) on tenant data — cross-tenant leak risk.`,
        })
      }
    }
  }

  // Invariant 3 — tenant tables have a policy or are documented service-role-only.
  for (const t of tables) {
    if (!t.has_tenant_id || SERVICE_ROLE_ONLY.has(t.table_name)) continue
    if ((policiesByTable.get(t.table_name) ?? []).length === 0) {
      findings.push({
        level: 'ERROR',
        table: t.table_name,
        message: 'Tenant-scoped table with RLS on but ZERO policies — unreachable to tenants. Add a policy or document in SERVICE_ROLE_ONLY.',
      })
    }
  }

  // Invariant 4 — only documented public tables carry a permissive true policy.
  for (const t of tables) {
    if (t.has_tenant_id || PUBLIC_TRUE_ALLOWED.has(t.table_name)) continue
    for (const p of policiesByTable.get(t.table_name) ?? []) {
      if (isPermissiveTrue(p) && !isServiceRoleOnly(p)) {
        findings.push({
          level: 'WARN',
          table: t.table_name,
          message: `Non-tenant table exposed via "${p.policy}" (${p.cmd}, roles=${p.roles.join('|')}) USING/WITH CHECK (true). Confirm intent; add to PUBLIC_TRUE_ALLOWED with justification or scope the policy.`,
        })
      }
    }
  }

  const errors = findings.filter((f) => f.level === 'ERROR').length
  const warns = findings.filter((f) => f.level === 'WARN').length

  if (findings.length === 0) {
    console.log(`✓ ${tables.length} tables checked. No RLS findings.`)
    return 0
  }

  console.log(`${tables.length} tables checked. ${errors} ERROR, ${warns} WARN.`)
  console.log('')
  for (const f of findings) {
    console.log(`  [${f.level}] ${f.table}: ${f.message}`)
  }
  return errors > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Audit script failed:', err)
    process.exit(2)
  })
