import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { UsersTable } from './UsersTable'
import { InviteUserForm } from './InviteUserForm'
import { requireUser } from '@/lib/actions/auth'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const admin = createAdminClient()
  const supabase = await createClient()

  // Establish the acting user's tenant so we can mark orphans relative to it.
  const { tenantId } = await requireUser()

  const { data: { user: currentUser } } = await supabase.auth.getUser()

  // Two queries: (1) all profiles; (2) active memberships in the current tenant.
  // profiles.id and tenant_members.user_id both reference auth.users.id — there
  // is no direct FK between them, so we stitch in app code.
  const [profilesRes, membershipsRes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, full_name, role, is_active, last_login_at, created_at')
      .order('created_at', { ascending: false }),
    admin
      .from('tenant_members')
      .select('user_id, role')
      .eq('tenant_id', tenantId)
      .eq('is_active', true),
  ])

  const tenantRoleByUser = new Map<string, string>()
  for (const m of membershipsRes.data ?? []) {
    tenantRoleByUser.set(m.user_id as string, m.role as string)
  }

  const rows = (profilesRes.data ?? []).map((p) => {
    const tenantRole = tenantRoleByUser.get(p.id)
    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      role: tenantRole ?? p.role, // prefer per-tenant role for display
      is_active: p.is_active,
      last_login_at: p.last_login_at,
      created_at: p.created_at,
      has_tenant_membership: !!tenantRole,
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
