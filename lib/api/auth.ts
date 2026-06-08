import { cookies } from 'next/headers'
import { createClient, createJwtClient } from '@/lib/supabase/server'
import { verifyServiceJwt } from '@/lib/auth/service-jwt'
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
 * Supports two auth paths:
 * - JWT path (SKS / ehow): reads eq_service_jwt cookie set by /api/shell-auth.
 *   Returns a Bearer-authenticated supabase client so RLS policies work.
 * - Standard path (EQ entity): Supabase session + tenant_members lookup.
 */
export async function getApiUser() {
  // Fast path: Shell JWT cookie (Plan B). ehow has no tenant_members.
  const cookieStore = await cookies()
  const serviceJwtRaw = cookieStore.get('eq_service_jwt')?.value
  if (serviceJwtRaw) {
    const claims = verifyServiceJwt(serviceJwtRaw)
    if (claims?.app_metadata?.tenant_id && claims.app_metadata.eq_role) {
      const role = claims.app_metadata.eq_role as Role
      return {
        supabase: createJwtClient(serviceJwtRaw),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: { id: claims.sub, email: claims.app_metadata.email ?? '' } as any,
        tenantId: claims.app_metadata.tenant_id,
        role,
        canonicalRole: role,
      }
    }
  }

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
