import { fromServiceRole, type EqRole } from '@eq-solutions/roles'
import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

// Re-export the canonical-backed role helpers from the single source
// (lib/utils/roles) so callers importing from '@/lib/api/auth' and from
// '@/lib/utils/roles' share one implementation — no drift (C6, 2026-06-04).
export { isAdmin, canWrite, isSuperAdmin } from '@/lib/utils/roles'

/**
 * Resolves the current user, their tenant membership, and role.
 * Returns null values if not authenticated or not a member of any tenant.
 *
 * `role` is Service's own tenant_members.role (super_admin | admin |
 * supervisor | technician | read_only). `canonicalRole` is that role mapped
 * onto the canonical EqRole via `fromServiceRole()` so app code can run
 * canonical permission checks, e.g. `can(canonicalRole, 'service.create')`
 * (from @eq-solutions/roles). It is null when there is no membership or the
 * raw role is unrecognised.
 */
export async function getApiUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, tenantId: null, role: null, canonicalRole: null }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const role = (membership?.role as Role) ?? null
  const canonicalRole: EqRole | null = role ? fromServiceRole(role) : null

  return {
    supabase,
    user,
    tenantId: (membership?.tenant_id as string) ?? null,
    role,
    canonicalRole,
  }
}
