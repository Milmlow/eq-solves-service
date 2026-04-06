import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Fetch counts in parallel
  const [customersRes, sitesRes, assetsRes, jobPlansRes, scheduledRes, inProgressRes, overdueRes, completeRes] = await Promise.all([
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('sites').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('assets').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('job_plans').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'overdue'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'complete'),
  ])

  const entityStats = [
    { label: 'Customers', value: customersRes.count ?? 0, href: '/customers' },
    { label: 'Sites', value: sitesRes.count ?? 0, href: '/sites' },
    { label: 'Assets', value: assetsRes.count ?? 0, href: '/assets' },
    { label: 'Job Plans', value: jobPlansRes.count ?? 0, href: '/job-plans' },
  ]

  const maintenanceStats = [
    { label: 'Scheduled', value: scheduledRes.count ?? 0, href: '/maintenance?status=scheduled', color: 'text-eq-deep' },
    { label: 'In Progress', value: inProgressRes.count ?? 0, href: '/maintenance?status=in_progress', color: 'text-eq-sky' },
    { label: 'Overdue', value: overdueRes.count ?? 0, href: '/maintenance?status=overdue', color: 'text-amber-600' },
    { label: 'Complete', value: completeRes.count ?? 0, href: '/maintenance?status=complete', color: 'text-green-600' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Dashboard' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Dashboard</h1>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {entityStats.map(({ label, value, href }) => (
          <a key={label} href={href} className="block hover:ring-2 hover:ring-eq-sky/30 rounded-lg transition-all">
            <Card>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">{label}</p>
              <p className="text-3xl font-bold text-eq-ink">{value.toLocaleString()}</p>
            </Card>
          </a>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Maintenance Checks</h2>
        <div className="grid grid-cols-4 gap-4">
          {maintenanceStats.map(({ label, value, href, color }) => (
            <a key={label} href={href} className="block hover:ring-2 hover:ring-eq-sky/30 rounded-lg transition-all">
              <Card>
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
