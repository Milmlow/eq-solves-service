import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { IntegrationsClient } from './IntegrationsClient'

export const dynamic = 'force-dynamic'

export default function IntegrationsPage() {
  // Check config server-side so the client component knows whether to show
  // the "not configured" warning without exposing env var names to the browser.
  const fieldConfigured = !!(process.env.FIELD_API_URL && process.env.EQ_SECRET_SALT)

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Admin', href: '/admin' },
            { label: 'Connected Apps' },
          ]}
        />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Connected Apps</h1>
        <p className="text-sm text-eq-grey mt-1">
          Sync data between EQ Service and other apps in the EQ suite.
        </p>
      </div>

      <IntegrationsClient fieldConfigured={fieldConfigured} />
    </div>
  )
}
