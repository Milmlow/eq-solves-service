import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Fetch counts in parallel
  const [
    customersRes, sitesRes, assetsRes, jobPlansRes,
    scheduledRes, inProgressRes, overdueRes, completeRes,
    testTotalRes, testPassRes, testFailRes, testDefectRes,
    acbTotalRes, acbPassRes, acbFailRes, acbDefectRes,
    nsxTotalRes, nsxPassRes, nsxFailRes, nsxDefectRes,
  ] = await Promise.all([
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('sites').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('assets').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('job_plans').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'overdue'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'complete'),
    supabase.from('test_records').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('test_records').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('result', 'pass'),
    supabase.from('test_records').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('result', 'fail'),
    supabase.from('test_records').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('result', 'defect'),
    supabase.from('acb_tests').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('acb_tests').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('overall_result', 'Pass'),
    supabase.from('acb_tests').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('overall_result', 'Fail'),
    supabase.from('acb_tests').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('overall_result', 'Defect'),
    supabase.from('nsx_tests').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('nsx_tests').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('overall_result', 'Pass'),
    supabase.from('nsx_tests').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('overall_result', 'Fail'),
    supabase.from('nsx_tests').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('overall_result', 'Defect'),
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

  const testStats = [
    { label: 'Total Tests', value: testTotalRes.count ?? 0, href: '/testing', color: 'text-eq-deep' },
    { label: 'Passed', value: testPassRes.count ?? 0, href: '/testing?result=pass', color: 'text-green-600' },
    { label: 'Failed', value: testFailRes.count ?? 0, href: '/testing?result=fail', color: 'text-red-600' },
    { label: 'Defects', value: testDefectRes.count ?? 0, href: '/testing?result=defect', color: 'text-amber-600' },
  ]

  const acbStats = [
    { label: 'Total ACB Tests', value: acbTotalRes.count ?? 0, href: '/acb-testing', color: 'text-eq-deep' },
    { label: 'Passed', value: acbPassRes.count ?? 0, href: '/acb-testing?overall_result=Pass', color: 'text-green-600' },
    { label: 'Failed', value: acbFailRes.count ?? 0, href: '/acb-testing?overall_result=Fail', color: 'text-red-600' },
    { label: 'Defects', value: acbDefectRes.count ?? 0, href: '/acb-testing?overall_result=Defect', color: 'text-amber-600' },
  ]

  const nsxStats = [
    { label: 'Total NSX Tests', value: nsxTotalRes.count ?? 0, href: '/nsx-testing', color: 'text-eq-deep' },
    { label: 'Passed', value: nsxPassRes.count ?? 0, href: '/nsx-testing?overall_result=Pass', color: 'text-green-600' },
    { label: 'Failed', value: nsxFailRes.count ?? 0, href: '/nsx-testing?overall_result=Fail', color: 'text-red-600' },
    { label: 'Defects', value: nsxDefectRes.count ?? 0, href: '/nsx-testing?overall_result=Defect', color: 'text-amber-600' },
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

      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Test Records</h2>
        <div className="grid grid-cols-4 gap-4">
          {testStats.map(({ label, value, href, color }) => (
            <a key={label} href={href} className="block hover:ring-2 hover:ring-eq-sky/30 rounded-lg transition-all">
              <Card>
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
              </Card>
            </a>
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">ACB Tests</h2>
        <div className="grid grid-cols-4 gap-4">
          {acbStats.map(({ label, value, href, color }) => (
            <a key={label} href={href} className="block hover:ring-2 hover:ring-eq-sky/30 rounded-lg transition-all">
              <Card>
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
              </Card>
            </a>
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">NSX Tests</h2>
        <div className="grid grid-cols-4 gap-4">
          {nsxStats.map(({ label, value, href, color }) => (
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
