import type { SupabaseClient } from '@supabase/supabase-js'
import { isEqRole } from '@eq-solutions/roles'

/**
 * A membership claim carried in the (HMAC-verified) `eq_shell_session` cookie.
 *
 * `tenant_id` is the CANONICAL/Shell id. It must NEVER be used as a Service
 * `tenants.id`: the two registries are independent and actually collide —
 * canonical "EQ Solutions" shares an id with Service "Demo Electrical". The
 * only safe cross-app key is `slug`. The session cookie does not carry `slug`
 * yet (a Shell-side addition — see docs/proposals/tenant-registry-reconciliation.md);
 * until it does, provisioning is a deliberate no-op.
 */
export interface ShellMembership {
  tenant_id: string
  role: string
  /** Canonical tenant slug — the safe cross-app join key. Added by Shell later. */
  slug?: string
}

/**
 * Provision `tenant_members` rows from the Shell cookie's membership list so a
 * Shell-authenticated user doesn't land on the "No tenant assigned" gate after
 * the cookie SSO establishes their session.
 *
 * Design / safety:
 * - **Slug-only mapping.** Tenants are matched by `slug` against Service's own
 *   `tenants` table — never by `tenant_id`. The canonical and Service id spaces
 *   collide, so id-mapping would assign across tenants. Slug is the only safe
 *   key. No slug in the cookie → nothing is provisioned (safe no-op), rather
 *   than something wrong.
 * - **No escalation:** ignores `is_platform_admin` (C6 isolation — cross-tenant
 *   power is the service-role channel, never a tenant-held role).
 * - **Canonical role,** validated with `isEqRole`, stored directly.
 * - **Non-clobbering:** skips entirely if the user already has an active
 *   membership, so it never overwrites a manual assignment.
 * - **Best-effort:** any failure is swallowed — provisioning must never block
 *   the SSO session.
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

    // Build slug -> role from memberships that carry a slug + a valid role.
    // Cookies without slugs (today's wire shape) yield an empty map → no-op.
    const roleBySlug = new Map<string, string>()
    for (const m of memberships) {
      if (m.slug && isEqRole(m.role)) roleBySlug.set(m.slug, m.role)
    }
    if (roleBySlug.size === 0) return

    // Resolve slugs against THIS app's tenants — only ones Service hosts +
    // are active. The id comes from Service's row, never from the cookie.
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, slug')
      .in('slug', [...roleBySlug.keys()])
      .eq('is_active', true)

    const rows = (tenants ?? [])
      .filter((t) => roleBySlug.has(t.slug as string))
      .map((t) => ({
        user_id: userId,
        tenant_id: t.id as string,
        role: roleBySlug.get(t.slug as string) as string,
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
