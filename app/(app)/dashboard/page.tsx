import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { StatusBadge } from '@/components/ui/StatusBadge'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Fetch counts in parallel
  const [customersRes, sitesRes, assetsRes, jobPlansRes] = await Promise.all([
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('sites').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('assets').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('job_plans').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ])

  const stats = [
    { label: 'Customers', value: customersRes.count ?? 0, href: '/customers' },
    { label: 'Sites', value: sitesRes.count ?? 0, href: '/sites' },
    { label: 'Assets', value: assetsRes.count ?? 0, href: '/assets' },
    { label: 'Job Plans', value: jobPlansRes.count ?? 0, href: '/job-plans' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Dashboard' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Dashboard</h1>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {stats.map(({ label, value, href }) => (
          <a key={label} href={href} className="block hover:ring-2 hover:ring-eq-sky/30 rounded-lg transition-all">
            <Card>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">{label}</p>
              <p className="text-3xl font-bold text-eq-ink">{value.toLocaleString()}</p>
            </Card>
          </a>
        ))}
      </div>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-eq-ink">Recent Maintenance Checks</h2>
          <StatusBadge status="not-started" />
        </div>
        <p className="text-sm text-eq-grey">No maintenance checks yet. This section will populate in Phase 3.</p>
      </Card>
    </div>
  )
}
