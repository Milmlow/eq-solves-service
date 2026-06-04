import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

// Re-export the canonical role helpers from the single source (lib/utils/roles)
// so callers importing from '@/lib/api/auth' and from '@/lib/utils/roles' share
// one implementation — no drift (C6). There is no isSuperAdmin: cross-tenant
// power is removed (migration 0114).
export { isAdmin, canWrite } from '@/lib/utils/roles'

/**
 * Resolves the current user, their tenant membership, and role.
 * Returns null values if not authenticated or not a member of any tenant.
 *
 * `role` is the tenant_members.role, which is a canonical EqRole (migration
 * 0114): manager | supervisor | employee | apprentice | labour_hire. App code
 * can run canonical permission checks directly, e.g. `can(role, 'service.create')`
 * (from @eq-solutions/roles). `canonicalRole` is kept as an alias of `role`
 * for callers that read it explicitly.
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

  return {
    supabase,
    user,
    tenantId: (membership?.tenant_id as string) ?? null,
    role,
    canonicalRole: role,
  }
}
