import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { UsersTable } from './UsersTable'
import { InviteUserForm } from './InviteUserForm'
import { requireUser } from '@/lib/actions/auth'

export const dynamic = 'force-dynamic'

/**
 * Admin → Users.
 *
 * This page lists ONLY users who have a `tenant_members` row for the acting
 * admin's current tenant — both active members and previously-removed ones
 * (so the "Attach" affordance still works for re-inviting them).
 *
 * Until 2026-04-21 this page listed every profile in the database, which
 * meant an SKS admin could see Demo / Equinix / Webb users they had no
 * business knowing about — a tenant-isolation breach in the UI even though
 * RLS still prevented data access. C1 fix: query tenant_members first, then
 * fetch profiles only for those user_ids.
 */
export default async function AdminUsersPage() {
  const admin = createAdminClient()
  const supabase = await createClient()

  // Establish the acting user's tenant — every query below is scoped to this.
  const { tenantId } = await requireUser()

  const { data: { user: currentUser } } = await supabase.auth.getUser()

  // 1. Memberships for THIS tenant only (both active and soft-removed).
  //    Soft-removed rows are kept so the admin can see who's been removed
  //    and re-attach them via the "Attach" button. No hard deletes — ever.
  const { data: memberships } = await admin
    .from('tenant_members')
    .select('user_id, role, is_active')
    .eq('tenant_id', tenantId)

  const memberIds = (memberships ?? []).map((m) => m.user_id as string)

  // 2. Profiles for just those users. If memberIds is empty (brand new
  //    tenant) we skip the round-trip entirely.
  const profilesRes = memberIds.length
    ? await admin
        .from('profiles')
        .select('id, email, full_name, role, is_active, last_login_at, created_at')
        .in('id', memberIds)
        .order('created_at', { ascending: false })
    : { data: [] as Array<{
        id: string; email: string; full_name: string | null; role: string;
        is_active: boolean; last_login_at: string | null; created_at: string;
      }> }

  // Stitch per-tenant role + per-tenant active state onto the profile row.
  const membershipByUser = new Map<string, { role: string; is_active: boolean }>()
  for (const m of memberships ?? []) {
    membershipByUser.set(m.user_id as string, {
      role: m.role as string,
      is_active: m.is_active as boolean,
    })
  }

  const rows = (profilesRes.data ?? []).map((p) => {
    const tm = membershipByUser.get(p.id)
    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      // Per-tenant role wins over legacy global profiles.role for display.
      role: tm?.role ?? p.role,
      // Account-level disable (signs them out everywhere).
      is_active: p.is_active,
      // Tenant-level removal (soft-deleted membership in this tenant only).
      is_active_in_tenant: tm?.is_active ?? false,
      last_login_at: p.last_login_at,
      created_at: p.created_at,
      has_tenant_membership: !!tm?.is_active,
    }
  })

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-eq-ink">Users</h1>
          <p className="text-sm text-eq-grey mt-1">
            Invite, disable, and manage roles. <strong className="font-semibold">Remove</strong> takes a user out of this tenant only — they can be re-attached. <strong className="font-semibold">Disable account</strong> blocks sign-in across all tenants. Nothing is ever hard-deleted.
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Invite new user</h2>
        <InviteUserForm />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <UsersTable users={rows} currentUserId={currentUser?.id ?? ''} />
      </div>
    </div>
  )
}
