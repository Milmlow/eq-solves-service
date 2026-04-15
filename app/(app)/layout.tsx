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
    // Fetch ALL active memberships with their tenant's setup state.
    // Previously this used .limit(1) with no ordering, which made Postgres
    // return an arbitrary row — any admin with multiple memberships could
    // land on an un-onboarded tenant and get force-dropped into the
    // OnboardingWizard ("create your own project" screen).
    const { data: memberships } = await supabase
      .from('tenant_members')
      .select('role, tenant_id, created_at, tenants!inner(name, setup_completed_at)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (memberships && memberships.length > 0) {
      // Prefer a tenant that is already onboarded; otherwise fall back to
      // the earliest-joined membership so the choice is at least deterministic.
      type MembershipRow = {
        role: string
        tenant_id: string
        created_at: string
        tenants: { name: string; setup_completed_at: string | null } | null
      }
      const rows = memberships as unknown as MembershipRow[]
      const completed = rows.find((m) => m.tenants?.setup_completed_at)
      const membership = completed ?? rows[0]

      isAdmin = membership.role === 'super_admin' || membership.role === 'admin'

      // Only show the onboarding wizard if EVERY tenant this user belongs to
      // is un-onboarded. A super_admin/admin attached to even one completed
      // tenant should never see the wizard again.
      if (isAdmin && !rows.some((m) => m.tenants?.setup_completed_at)) {
        showOnboarding = true
        tenantName = membership.tenants?.name ?? null
      }
    }

    // Get user profile name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()
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
