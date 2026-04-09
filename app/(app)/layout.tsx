import { Sidebar } from '@/components/ui/Sidebar'
import { HelpWidget } from '@/components/ui/HelpWidget'
import { OnboardingWizard } from './onboarding/OnboardingWizard'
import { createClient } from '@/lib/supabase/server'
import { getTenantSettings } from '@/lib/tenant/getTenantSettings'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let isAdmin = false
  let showOnboarding = false
  let userName: string | null = null
  let tenantName: string | null = null

  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (membership) {
      isAdmin = membership.role === 'super_admin' || membership.role === 'admin'

      // Check onboarding status
      if (isAdmin) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name, setup_completed_at')
          .eq('id', membership.tenant_id)
          .single()

        if (tenant && !tenant.setup_completed_at) {
          showOnboarding = true
          tenantName = tenant.name
        }
      }
    }

    // Get user profile name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
    userName = profile?.full_name ?? null
  }

  const { settings } = await getTenantSettings()

  // Inject tenant colours as CSS custom properties — overrides :root defaults
  const tenantStyle = {
    '--eq-sky': settings.primary_colour,
    '--eq-deep': settings.deep_colour,
    '--eq-ice': settings.ice_colour,
    '--eq-ink': settings.ink_colour,
  } as React.CSSProperties

  return (
    <div className="flex min-h-screen bg-gray-50" style={tenantStyle}>
      <Sidebar isAdmin={isAdmin} settings={settings} />
      <main className="flex-1 min-w-0 px-4 py-4 pt-18 lg:pt-8 lg:px-8 lg:py-8">
        {children}
      </main>
      <HelpWidget />
      {showOnboarding && (
        <OnboardingWizard userName={userName} companyName={tenantName} />
      )}
    </div>
  )
}
