'use server'

import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

/**
 * Resolves the current user, their tenant ID, and role for server actions.
 * Throws if not authenticated or not a member of any tenant.
 */
export async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) throw new Error('No tenant membership.')

  return {
    supabase,
    user,
    tenantId: membership.tenant_id as string,
    role: membership.role as Role,
  }
}
