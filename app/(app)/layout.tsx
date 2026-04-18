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

    // No tenant membership → show a clear error instead of an empty app shell
    if (!memberships || memberships.length === 0) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">No tenant assigned</h1>
            <p className="text-sm text-gray-500 mb-1">
              Your account <span className="font-medium text-gray-700">{user.email}</span> exists but hasn&apos;t been assigned to an organisation yet.
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Contact your administrator to be added to a tenant.
            </p>
            <a
              href="/auth/signout"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-eq-deep rounded-lg hover:bg-eq-sky transition-colors"
            >
              Sign out
            </a>
          </div>
        </div>
      )
    }

    if (memberships.length > 0) {
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
