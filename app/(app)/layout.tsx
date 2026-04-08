import { Sidebar } from '@/components/ui/Sidebar'
import { HelpWidget } from '@/components/ui/HelpWidget'
import { createClient } from '@/lib/supabase/server'
import { getTenantSettings } from '@/lib/tenant/getTenantSettings'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let isAdmin = false
  if (user) {
    const { data } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()
    isAdmin = data?.role === 'super_admin' || data?.role === 'admin'
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
      <main className="flex-1 min-w-0 p-8">
        {children}
      </main>
      <HelpWidget />
    </div>
  )
}
