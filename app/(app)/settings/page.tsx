import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { requireUser } from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { UserSettingsForm } from './UserSettingsForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { user, role } = await requireUser()
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, last_login_at, created_at')
    .eq('id', user.id)
    .single()

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Settings' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Settings</h1>
        <p className="text-sm text-eq-grey mt-1">Manage your profile and account preferences.</p>
      </div>

      <UserSettingsForm
        email={user.email ?? ''}
        fullName={profile?.full_name ?? ''}
        role={role}
        lastLogin={profile?.last_login_at ?? null}
        createdAt={profile?.created_at ?? ''}
      />
    </div>
  )
}
