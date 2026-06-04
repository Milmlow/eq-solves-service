import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

/**
 * Resolves the current user, their tenant membership, and role.
 * Returns null values if not authenticated or not a member of any tenant.
 */
export async function getApiUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, tenantId: null, role: null }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  return {
    supabase,
    user,
    tenantId: (membership?.tenant_id as string) ?? null,
    role: (membership?.role as Role) ?? null,
  }
}

// Role predicates live in a single canonical source — re-exported here so
// API routes keep importing them from '@/lib/api/auth' (Sprint C6). The old
// duplicated string-array matrix is gone; `lib/utils/roles` decides via the
// @eq-solutions/roles `can()` matrix. `isSuperAdmin` was removed: the
// canonical model has no tier above `manager`, and the only former
// consumers — the /api/tenants* platform endpoints — now gate out-of-band
// on EQ_PLATFORM_ADMIN_KEY (see lib/api/platform.ts), not a tenant role.
export { isAdmin, canWrite } from '@/lib/utils/roles'
