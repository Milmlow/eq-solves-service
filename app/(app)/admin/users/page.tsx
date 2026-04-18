import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { UsersTable } from './UsersTable'
import { InviteUserForm } from './InviteUserForm'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const admin = createAdminClient()
  const supabase = await createClient()

  const { data: { user: currentUser } } = await supabase.auth.getUser()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, full_name, role, is_active, last_login_at, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-eq-ink">Users</h1>
          <p className="text-sm text-eq-grey mt-1">
            Invite, deactivate, and manage roles. Users are never deleted — only deactivated.
          </p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Invite new user</h2>
        <InviteUserForm />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <UsersTable users={profiles ?? []} currentUserId={currentUser?.id ?? ''} />
      </div>
    </div>
  )
}
