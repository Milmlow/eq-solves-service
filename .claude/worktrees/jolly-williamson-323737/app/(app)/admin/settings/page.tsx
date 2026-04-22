import { getTenantSettings } from '@/lib/tenant/getTenantSettings'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { TenantSettingsForm } from './TenantSettingsForm'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const { settings } = await getTenantSettings()

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Admin', href: '/admin/users' }, { label: 'Tenant Settings' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Tenant Settings</h1>
        <p className="text-sm text-eq-grey mt-1">
          Configure branding, colours, and platform settings for your organisation.
        </p>
      </div>

      <TenantSettingsForm settings={settings} />
    </div>
  )
}
