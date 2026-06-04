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
 * Roles safe to auto-grant from a cross-app claim. Deliberately EXCLUDES
 * `manager` (admin-equivalent) and any super_admin: admin access is never
 * minted unattended from a signed cookie. A Shell `manager` simply isn't
 * auto-provisioned — they fall through to explicit/invite (the request-access
 * flow), where a human grants the elevated role.
 */
const AUTO_GRANT_ROLES = new Set(['supervisor', 'employee', 'apprentice', 'labour_hire'])

/**
 * Provision `tenant_members` rows from the Shell cookie's membership list so a
 * Shell-authenticated user doesn't land on the "No tenant assigned" gate.
 *
 * Safety model (decisions 2026-06-04, post-steelman):
 * - **Slug-only mapping.** Tenants are matched by `slug` against Service's own
 *   `tenants`, never by `tenant_id`. The id spaces collide; slug is the only
 *   safe key. No slug in the cookie -> nothing provisioned (safe no-op).
 * - **Per-tenant opt-in.** Only tenants with `tenant_settings.allow_sso_autoprovision
 *   = true` are eligible. Default is false, so this is inert until a tenant is
 *   deliberately opted in — honouring the twice-reverted auto-routing lesson.
 * - **Role clamp.** Only non-admin roles (AUTO_GRANT_ROLES) are auto-granted;
 *   `manager`/admin never is. `is_platform_admin` is ignored entirely (C6).
 * - **Non-clobbering.** Skips if the user already has any active membership.
 * - **Audited.** Every grant writes an `audit_logs` row with source='shell_sso'
 *   + a deterministic mutation_id, so a wrong grant is traceable and bulk-reversible.
 * - **Best-effort but observable.** Never blocks the SSO session; failures are
 *   logged (not silently swallowed).
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

    // slug -> role, keeping only valid canonical roles that are safe to auto-grant.
    const roleBySlug = new Map<string, string>()
    for (const m of memberships) {
      if (m.slug && isEqRole(m.role) && AUTO_GRANT_ROLES.has(m.role)) roleBySlug.set(m.slug, m.role)
    }
    if (roleBySlug.size === 0) return

    // Resolve slugs against Service's OWN active tenants — id comes from Service's
    // row, never from the cookie.
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, slug')
      .in('slug', [...roleBySlug.keys()])
      .eq('is_active', true)
    if (!tenants?.length) return

    // Gate: only tenants that have explicitly opted into SSO auto-provisioning.
    const { data: settings } = await admin
      .from('tenant_settings')
      .select('tenant_id, allow_sso_autoprovision')
      .in('tenant_id', tenants.map((t) => t.id))
    const optedIn = new Set(
      (settings ?? [])
        .filter((s) => s.allow_sso_autoprovision === true)
        .map((s) => s.tenant_id as string),
    )

    const targets = tenants
      .filter((t) => optedIn.has(t.id as string) && roleBySlug.has(t.slug as string))
      .map((t) => ({ tenantId: t.id as string, slug: t.slug as string, role: roleBySlug.get(t.slug as string) as string }))
    if (!targets.length) return

    for (const t of targets) {
      const { data: inserted, error } = await admin
        .from('tenant_members')
        .upsert(
          { user_id: userId, tenant_id: t.tenantId, role: t.role, is_active: true } as never,
          { onConflict: 'user_id,tenant_id', ignoreDuplicates: false },
        )
        .select('id')
        .maybeSingle()

      if (error) {
        console.error('[shell-provision] tenant_members upsert failed', {
          userId, tenant: t.tenantId, slug: t.slug, error: error.message,
        })
        continue
      }

      // Audit the grant with provenance — the durable trail for bulk-revert.
      const { error: auditErr } = await admin.from('audit_logs').insert({
        tenant_id: t.tenantId,
        user_id: userId,
        action: 'tenant_member.auto_provisioned',
        entity_type: 'tenant_member',
        entity_id: (inserted as { id?: string } | null)?.id ?? null,
        summary: `Auto-provisioned user into "${t.slug}" as ${t.role} via Shell SSO`,
        metadata: { source: 'shell_sso', slug: t.slug, role: t.role } as never,
        mutation_id: `shell_sso:${userId}:${t.tenantId}`,
      } as never)
      if (auditErr) {
        console.error('[shell-provision] audit insert failed', {
          userId, tenant: t.tenantId, error: auditErr.message,
        })
      }
    }
  } catch (e) {
    // Best-effort: provisioning must never block the SSO session — but be loud.
    console.error('[shell-provision] unexpected error', e instanceof Error ? e.message : String(e))
  }
}
