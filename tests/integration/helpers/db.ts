/**
 * Integration-test helpers — create test tenants, users, and signed-in
 * clients against a local Supabase instance.
 *
 * Two client types:
 *  - `adminClient()` — bypasses RLS via service_role. Used for seeding +
 *    cleanup. NEVER use this to assert RLS behaviour — it'd pass any test.
 *  - `signedInClient(email, password)` — signs in via anon key + password,
 *    returns the authenticated PostgREST client. `auth.uid()` inside
 *    Postgres resolves to this user's id, so RLS policies evaluate
 *    correctly. This is what tests use to check "can user X see Y".
 *
 * Test data isolation: every seed uses fresh UUIDs (Postgres `gen_random_uuid()`
 * at the DB layer would also work, but we generate them in Node so we have
 * the IDs available before insert to wire foreign keys). Tests are
 * responsible for cleaning up their own seeds via `cleanupTenant(tenantId)`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export interface SeededTenant {
  tenantId: string
  user: {
    id: string
    email: string
    password: string
  }
}

/**
 * Creates a tenant + one admin user + tenant_members membership in a single
 * call. Returns the IDs and credentials needed to sign in as that user.
 *
 * The user is created via the Supabase Admin API (`auth.admin.createUser`)
 * with email_confirm=true so they can sign in immediately.
 */
export async function seedTenantWithAdmin(suffix: string): Promise<SeededTenant> {
  const admin = adminClient()
  const tenantId = randomUUID()
  const password = `Test${randomUUID().slice(0, 12)}!`
  const email = `it-${suffix}-${Date.now()}@test.local`

  // 1. Tenant row
  const { error: tErr } = await admin.from('tenants').insert({
    id: tenantId,
    name: `IT Tenant ${suffix}`,
    slug: `it-${suffix}-${Date.now()}`,
    is_active: true,
  })
  if (tErr) throw new Error(`seed tenant failed: ${tErr.message}`)

  // 2. Auth user
  const { data: userData, error: uErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (uErr || !userData.user) throw new Error(`seed user failed: ${uErr?.message ?? 'no user'}`)

  // 3. Membership
  const { error: mErr } = await admin.from('tenant_members').insert({
    user_id: userData.user.id,
    tenant_id: tenantId,
    role: 'admin',
    is_active: true,
  })
  if (mErr) throw new Error(`seed membership failed: ${mErr.message}`)

  return {
    tenantId,
    user: { id: userData.user.id, email, password },
  }
}

/**
 * Signs in via the anon client + password — returns the authenticated
 * client whose JWT carries the user's `sub` claim. `auth.uid()` in any
 * subsequent PostgREST call will resolve to this user's id.
 */
export async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

/**
 * Tear-down. Deletes the auth user (cascades to profile via handle_new_user
 * trigger's ON DELETE CASCADE on the FK) and the tenant row (cascades to
 * tenant_members, customers, sites, etc. via FK ON DELETE CASCADE chain).
 *
 * Errors swallowed — best-effort cleanup. Re-running with fresh UUIDs is
 * always safe even if a previous test's cleanup failed.
 */
export async function cleanupTenant(seed: SeededTenant): Promise<void> {
  const admin = adminClient()
  try {
    await admin.auth.admin.deleteUser(seed.user.id)
  } catch {
    // best-effort — re-running with fresh UUIDs is always safe
  }
  try {
    await admin.from('tenants').delete().eq('id', seed.tenantId)
  } catch {
    // best-effort
  }
}
