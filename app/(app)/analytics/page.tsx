import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { AnalyticsCharts } from './AnalyticsCharts'

export default async function AnalyticsPage() {
  const supabase = await createClient()

  // ── Fetch raw data in parallel ──
  const [
    { data: assets },
    { data: checks },
    { data: testRecords },
    { data: acbTests },
    { data: nsxTests },
    { data: instruments },
    { data: sites },
  ] = await Promise.all([
    supabase.from('assets').select('id, created_at, is_active').eq('is_active', true),
    supabase.from('maintenance_checks').select('id, status, due_date, completed_at, created_at'),
    supabase.from('test_records').select('id, result, test_date, created_at').eq('is_active', true),
    supabase.from('acb_tests').select('id, overall_result, test_date, created_at').eq('is_active', true),
    supabase.from('nsx_tests').select('id, overall_result, test_date, created_at').eq('is_active', true),
    supabase.from('instruments').select('id, status, calibration_due, is_active').eq('is_active', true),
    supabase.from('sites').select('id, name').eq('is_active', true),
  ])

  // ── Monthly test volume (last 12 months) ──
  const now = new Date()
  const months: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.toISOString().slice(0, 7)) // "YYYY-MM"
  }

  const monthLabels = months.map((m) => {
    const [y, mo] = m.split('-')
    const d = new Date(Number(y), Number(mo) - 1)
    return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })
  })

  // Count tests by month
  const generalByMonth = months.map((m) =>
    (testRecords ?? []).filter((t) => t.test_date?.startsWith(m)).length
  )
  const acbByMonth = months.map((m) =>
    (acbTests ?? []).filter((t) => t.test_date?.startsWith(m)).length
  )
  const nsxByMonth = months.map((m) =>
    (nsxTests ?? []).filter((t) => t.test_date?.startsWith(m)).length
  )

  // ── Compliance trend (last 12 months) ──
  const complianceByMonth = months.map((m) => {
    const monthChecks = (checks ?? []).filter((c) => c.due_date?.startsWith(m))
    const total = monthChecks.length
    const complete = monthChecks.filter((c) => c.status === 'complete').length
    return total > 0 ? Math.round((complete / total) * 100) : null
  })

  // ── Summary KPIs ──
  const totalAssets = assets?.length ?? 0
  const totalSites = sites?.length ?? 0
  const totalTests = (testRecords?.length ?? 0) + (acbTests?.length ?? 0) + (nsxTests?.length ?? 0)

  const allTestResults = [
    ...(testRecords ?? []).map((t) => t.result),
    ...(acbTests ?? []).map((t) => t.overall_result),
    ...(nsxTests ?? []).map((t) => t.overall_result),
  ]
  const passCount = allTestResults.filter((r) => r === 'pass' || r === 'Pass').length
  const overallPassRate = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0

  const activeChecks = checks?.length ?? 0
  const completedChecks = (checks ?? []).filter((c) => c.status === 'complete').length
  const overdueChecks = (checks ?? []).filter((c) => c.status === 'overdue').length
  const overallCompliance = activeChecks > 0 ? Math.round((completedChecks / activeChecks) * 100) : 0

  // ── Instrument calibration summary ──
  const today = now.toISOString().slice(0, 10)
  const instrumentsActive = (instruments ?? []).filter((i) => i.status === 'Active').length
  const instrumentsOverdue = (instruments ?? []).filter(
    (i) => i.is_active && i.calibration_due && i.calibration_due < today
  ).length
  const instrumentsOutForCal = (instruments ?? []).filter((i) => i.status === 'Out for Cal').length

  // ── Pass rates by test type ──
  const generalPass = (testRecords ?? []).filter((t) => t.result === 'pass').length
  const generalTotal = testRecords?.length ?? 0
  const acbPass = (acbTests ?? []).filter((t) => t.overall_result === 'Pass').length
  const acbTotal = acbTests?.length ?? 0
  const nsxPass = (nsxTests ?? []).filter((t) => t.overall_result === 'Pass').length
  const nsxTotal = nsxTests?.length ?? 0

  const chartData = {
    months: monthLabels,
    generalByMonth,
    acbByMonth,
    nsxByMonth,
    complianceByMonth,
  }

  const passRates = [
    { label: 'General Tests', pass: generalPass, total: generalTotal },
    { label: 'ACB Tests', pass: acbPass, total: acbTotal },
    { label: 'NSX Tests', pass: nsxPass, total: nsxTotal },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Analytics' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Analytics</h1>
        <p className="text-sm text-eq-grey mt-1">Platform-wide usage trends and performance metrics</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Total Assets</p>
          <p className="text-3xl font-bold text-eq-ink">{totalAssets.toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Total Sites</p>
          <p className="text-3xl font-bold text-eq-ink">{totalSites.toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Total Tests</p>
          <p className="text-3xl font-bold text-eq-ink">{totalTests.toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Pass Rate</p>
          <p className={`text-3xl font-bold ${overallPassRate >= 80 ? 'text-green-600' : overallPassRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {overallPassRate}%
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Compliance</p>
          <p className={`text-3xl font-bold ${overallCompliance >= 80 ? 'text-green-600' : overallCompliance >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {overallCompliance}%
          </p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Overdue Checks</p>
          <p className={`text-3xl font-bold ${overdueChecks > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {overdueChecks}
          </p>
        </Card>
      </div>

      {/* Charts */}
      <AnalyticsCharts data={chartData} />

      {/* Pass rates by type + Instruments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Pass Rate by Test Type</h2>
          <div className="space-y-3">
            {passRates.map(({ label, pass, total }) => {
              const rate = total > 0 ? Math.round((pass / total) * 100) : 0
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-eq-grey">{label}</span>
                    <span className="font-bold text-eq-ink">{rate}% ({pass}/{total})</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${rate >= 80 ? 'bg-green-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Instrument Calibration Status</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-eq-grey">Active instruments</span>
              <span className="text-sm font-bold text-eq-ink">{instrumentsActive}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-eq-grey">Out for calibration</span>
              <span className="text-sm font-bold text-eq-sky">{instrumentsOutForCal}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-eq-grey">Calibration overdue</span>
              <span className={`text-sm font-bold ${instrumentsOverdue > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {instrumentsOverdue}
              </span>
            </div>
            {instrumentsOverdue > 0 && (
              <a href="/instruments" className="text-xs text-eq-sky hover:text-eq-deep transition-colors">
                View overdue instruments →
              </a>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
