import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { IntegrationsClient } from './IntegrationsClient'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  // Check config server-side so the client component knows whether to show
  // the "not configured" warning without exposing env var names to the browser.
  const fieldConfigured     = !!(process.env.FIELD_API_URL && process.env.EQ_SECRET_SALT)
  const canonicalConfigured = !!(process.env.CANONICAL_API_KEY_SERVICE)

  // Fetch sync coverage stats. RLS scopes both queries to the current tenant
  // automatically — no manual tenant_id filter needed.
  const supabase = await createClient()

  const [
    { count: totalSites },
    { count: syncedSites },
    { count: totalCustomers },
    { count: canonicalCustomers },
    { count: canonicalSites },
    { count: totalAssets },
    { count: canonicalAssets },
  ] = await Promise.all([
    supabase
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('canonical_field_id', 'is', null),
    supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true),
    // canonical_id added in migration 0113 — types regenerated separately.
    supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('canonical_id', 'is', null),
    supabase
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('canonical_id', 'is', null),
    // canonical_id added in migration 0125
    supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('canonical_id', 'is', null),
  ])

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

      <IntegrationsClient
        fieldConfigured={fieldConfigured}
        canonicalConfigured={canonicalConfigured}
        totalSites={totalSites ?? 0}
        syncedSites={syncedSites ?? 0}
        totalCustomers={totalCustomers ?? 0}
        canonicalCustomers={canonicalCustomers ?? 0}
        canonicalSites={canonicalSites ?? 0}
        totalAssets={totalAssets ?? 0}
        canonicalAssets={canonicalAssets ?? 0}
      />
    </div>
  )
}
