import type { SupabaseClient } from '@supabase/supabase-js'
import { isEqRole } from '@eq-solutions/roles'

/**
 * A membership claim carried in the (HMAC-verified) `eq_shell_session` cookie.
 * tenant_id is a CANONICAL id, shared across the EQ suite — Field and Service
 * read `session.tenant_id` directly, so it maps 1:1 onto Service's `tenants.id`.
 */
export interface ShellMembership {
  tenant_id: string
  role: string
}

/**
 * Provision `tenant_members` rows from the Shell cookie's membership list so a
 * Shell-authenticated user doesn't land on the "No tenant assigned" gate after
 * the cookie SSO establishes their session.
 *
 * Design / safety:
 * - **Trust boundary:** the memberships come from an HMAC-signed Shell cookie
 *   (signed with EQ_SECRET_SALT), so Shell vouches for them. We still only
 *   assign tenants that EXIST and are ACTIVE in Service — never a tenant we
 *   don't host.
 * - **No escalation:** this deliberately ignores `is_platform_admin`. Per the
 *   C6 isolation model, cross-tenant power is the service-role channel, never a
 *   tenant-held role. Only genuine per-tenant memberships are provisioned.
 * - **Role:** Service now stores the canonical EQ vocabulary directly
 *   (manager | supervisor | employee | apprentice | labour_hire), so the Shell
 *   role IS the Service role — validated with isEqRole, no translation.
 * - **Non-clobbering:** only runs when the user has no active membership yet, so
 *   it never overwrites or downgrades a manually-assigned role.
 * - **Best-effort:** any failure is swallowed — provisioning must never block
 *   the SSO session itself.
 *
 * @param admin       service-role client (bypasses RLS for the upsert)
 * @param userId      the SERVICE auth.users id (from generateLink), NOT the
 *                    Shell user_id in the cookie
 * @param memberships the cookie's `memberships` array
 */
export async function provisionShellMemberships(
  admin: SupabaseClient,
  userId: string,
  memberships: ShellMembership[] | undefined,
): Promise<void> {
  if (!userId || !memberships?.length) return
  try {
    // Don't clobber an existing/explicit assignment.
    const { data: existing } = await admin
      .from('tenant_members')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (existing) return

    const wanted = memberships.filter((m) => m.tenant_id && isEqRole(m.role))
    if (!wanted.length) return

    // Only provision tenants Service actually hosts + are active. Canonical ids
    // are shared, but never trust a tenant we don't have a row for.
    const { data: validTenants } = await admin
      .from('tenants')
      .select('id')
      .in('id', wanted.map((m) => m.tenant_id))
      .eq('is_active', true)
    const valid = new Set((validTenants ?? []).map((t) => t.id as string))

    const rows = wanted
      .filter((m) => valid.has(m.tenant_id))
      .map((m) => ({
        user_id: userId,
        tenant_id: m.tenant_id,
        role: m.role,
        is_active: true,
      }))
    if (!rows.length) return

    await admin
      .from('tenant_members')
      // role is the canonical EqRole string; the generated column type is a
      // narrow union that lags the C6 rename, so cast at the call boundary.
      .upsert(rows as never, { onConflict: 'user_id,tenant_id', ignoreDuplicates: false })
  } catch {
    // Never block SSO on provisioning.
  }
}
