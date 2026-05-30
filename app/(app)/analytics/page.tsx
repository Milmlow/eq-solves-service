import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { AnalyticsFilters } from './AnalyticsFilters'
import { AnalyticsCharts } from './AnalyticsCharts'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const customerId = params.customer_id ?? ''
  // Date-range filter (S-W2-2). Applied to maintenance_checks.due_date and
  // the test tables' test_date. Empty = all-time (existing behaviour).
  const fromDate = params.from ?? ''
  const toDate = params.to ?? ''

  const supabase = await createClient()

  // Resolve the customer filter to a set of site IDs up front — the check
  // and test tables don't carry customer_id, so we scope them by site.
  // Empty customerId = tenant-wide (no site scoping).
  let customerSiteIds: string[] | null = null
  if (customerId) {
    const { data: custSites } = await supabase
      .from('sites')
      .select('id')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .limit(10000)
    customerSiteIds = (custSites ?? []).map((s) => s.id as string)
    // No sites for this customer → force an empty result set everywhere.
    if (customerSiteIds.length === 0) customerSiteIds = ['00000000-0000-0000-0000-000000000000']
  }

  // Helper to apply the shared site + date-range scoping to a query builder.
  // `dateCol` differs per table (checks use due_date, tests use test_date).
  function scope<T extends { in: (c: string, v: string[]) => T; gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
    q: T,
    dateCol: string,
    siteCol: string | null,
  ): T {
    let out = q
    if (customerSiteIds && siteCol) out = out.in(siteCol, customerSiteIds)
    if (fromDate) out = out.gte(dateCol, fromDate)
    if (toDate) out = out.lte(dateCol, toDate)
    return out
  }

  // ── Fetch raw data in parallel ──
  const [
    { count: assetCount },
    { data: checks },
    { data: testRecords },
    { data: acbTests },
    { data: nsxTests },
    { data: instruments },
    { data: sites },
    { data: customers },
  ] = await Promise.all([
    supabase.from('assets').select('id', { count: 'exact', head: true }).eq('is_active', true),
    scope(supabase.from('maintenance_checks').select('id, status, due_date, completed_at, created_at, assigned_to, site_id').eq('is_active', true), 'due_date', 'site_id').limit(10000),
    scope(supabase.from('test_records').select('id, result, test_date, created_at, site_id').eq('is_active', true), 'test_date', 'site_id').limit(10000),
    scope(supabase.from('acb_tests').select('id, overall_result, test_date, created_at, site_id').eq('is_active', true), 'test_date', 'site_id').limit(10000),
    scope(supabase.from('nsx_tests').select('id, overall_result, test_date, created_at, site_id').eq('is_active', true), 'test_date', 'site_id').limit(10000),
    supabase.from('instruments').select('id, status, calibration_due, is_active').eq('is_active', true).limit(10000),
    supabase.from('sites').select('id, name').eq('is_active', true).limit(10000),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name').limit(10000),
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
  const totalAssets = assetCount ?? 0
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

  // ── Maintenance health metrics ──
  const thisMonth = new Date().toISOString().slice(0, 7)
  const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7)

  const checksThisMonth = (checks ?? []).filter((c) => c.due_date?.startsWith(thisMonth)).length
  const checksLastMonth = (checks ?? []).filter((c) => c.due_date?.startsWith(lastMonth)).length
  const checksChangePercent = checksLastMonth > 0 ? Math.round(((checksThisMonth - checksLastMonth) / checksLastMonth) * 100) : 0

  const completedThisMonth = (checks ?? []).filter((c) => c.due_date?.startsWith(thisMonth) && c.status === 'complete').length

  // Avg days between created_at and completed_at for completed checks
  const completedWithDates = (checks ?? []).filter(
    (c) => c.status === 'complete' && c.completed_at && c.created_at
  )
  const avgTimeToComplete = completedWithDates.length > 0
    ? Math.round(
        completedWithDates.reduce((sum, c) => {
          // completed_at can be null in the DB; the upstream filter
          // (completedWithDates) only keeps rows where both are set,
          // so the ?? '' coerces the type without changing runtime.
          const created = new Date(c.created_at ?? '').getTime()
          const completed = new Date(c.completed_at ?? '').getTime()
          return sum + (completed - created) / (1000 * 60 * 60 * 24)
        }, 0) / completedWithDates.length
      )
    : 0

  const defectRate = totalTests > 0 ? ((checks?.length ?? 0 - completedChecks) / totalTests * 100).toFixed(1) : '0.0'

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

  // ── Per-technician cut (S-W2-2) ──
  // Aggregate the (already customer + date scoped) checks by assigned_to:
  // total / completed / overdue / avg days-to-complete. Answers "who is our
  // slowest tech?" — the question every account review asks.
  type TechAgg = { total: number; completed: number; overdue: number; sumDays: number; daysCount: number }
  const techAgg = new Map<string, TechAgg>()
  for (const c of checks ?? []) {
    const uid = c.assigned_to as string | null
    if (!uid) continue
    const a = techAgg.get(uid) ?? { total: 0, completed: 0, overdue: 0, sumDays: 0, daysCount: 0 }
    a.total++
    if (c.status === 'complete') {
      a.completed++
      if (c.completed_at && c.created_at) {
        const days = (new Date(c.completed_at).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24)
        if (Number.isFinite(days) && days >= 0) { a.sumDays += days; a.daysCount++ }
      }
    }
    if (c.status === 'overdue') a.overdue++
    techAgg.set(uid, a)
  }

  // Resolve technician display names for the rows we actually have.
  const techIds = [...techAgg.keys()]
  const techNameById = new Map<string, string>()
  if (techIds.length > 0) {
    const { data: techProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', techIds)
    for (const p of techProfiles ?? []) {
      techNameById.set(p.id, p.full_name ?? p.email ?? 'Unknown')
    }
  }

  const technicianRows = techIds
    .map((uid) => {
      const a = techAgg.get(uid)!
      return {
        id: uid,
        name: techNameById.get(uid) ?? 'Unknown',
        total: a.total,
        completed: a.completed,
        overdue: a.overdue,
        completionRate: a.total > 0 ? Math.round((a.completed / a.total) * 100) : 0,
        avgDays: a.daysCount > 0 ? Math.round(a.sumDays / a.daysCount) : null,
      }
    })
    // Busiest first, then slowest as the tiebreak.
    .sort((x, y) => y.total - x.total || (y.avgDays ?? 0) - (x.avgDays ?? 0))

  const customerOptions = (customers ?? []).map((c) => ({ value: c.id as string, label: c.name as string }))
  const selectedCustomerName = customerId
    ? (customers ?? []).find((c) => c.id === customerId)?.name ?? null
    : null
  const rangeLabel = fromDate || toDate
    ? `${fromDate || '…'} → ${toDate || '…'}`
    : null

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Analytics' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Analytics</h1>
        <p className="text-sm text-eq-grey mt-1">
          {selectedCustomerName || rangeLabel ? (
            <>
              Showing
              {selectedCustomerName ? <span className="font-medium text-eq-ink"> {selectedCustomerName}</span> : ' all customers'}
              {rangeLabel ? <span className="font-medium text-eq-ink"> · {rangeLabel}</span> : ''}
            </>
          ) : (
            'Platform-wide usage trends and performance metrics'
          )}
        </p>
      </div>

      {/* Customer + date-range cut (S-W2-2) */}
      <Card>
        <AnalyticsFilters customers={customerOptions} />
      </Card>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 cursor-help" title="Count of active assets from the assets table (is_active = true). Source: assets table.">
          <p className="text-xs font-bold text-sky-700 uppercase tracking-wide mb-3">Total Assets</p>
          <p className="text-4xl font-bold text-sky-900">{totalAssets.toLocaleString()}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 cursor-help" title="Count of active sites. Source: sites table (is_active = true).">
          <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-3">Total Sites</p>
          <p className="text-4xl font-bold text-green-900">{totalSites.toLocaleString()}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 cursor-help" title="Combined count of General test_records + ACB acb_tests + NSX nsx_tests (all active). Source: test_records + acb_tests + nsx_tests tables.">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">Total Tests</p>
          <p className="text-4xl font-bold text-amber-900">{totalTests.toLocaleString()}</p>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 cursor-help" title={`Tests with result 'pass' or 'Pass' Ã· total tests. ${passCount} passed out of ${totalTests}. Source: test_records.result + acb_tests.overall_result + nsx_tests.overall_result.`}>
          <p className="text-xs font-bold text-violet-700 uppercase tracking-wide mb-3">Pass Rate</p>
          <p className={`text-4xl font-bold ${overallPassRate >= 80 ? 'text-green-600' : overallPassRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {overallPassRate}<span className="text-2xl">%</span>
          </p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 cursor-help" title={`Completed checks Ã· all checks. ${completedChecks} completed out of ${activeChecks}. Source: maintenance_checks table (status = 'complete').`}>
          <p className="text-xs font-bold text-rose-700 uppercase tracking-wide mb-3">Compliance</p>
          <p className={`text-4xl font-bold ${overallCompliance >= 80 ? 'text-green-600' : overallCompliance >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {overallCompliance}<span className="text-2xl">%</span>
          </p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 cursor-help" title="Maintenance checks with status 'overdue'. Source: maintenance_checks table (status = 'overdue').">
          <p className="text-xs font-bold text-orange-700 uppercase tracking-wide mb-3">Overdue Checks</p>
          <p className={`text-4xl font-bold ${overdueChecks > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {overdueChecks}
          </p>
        </div>
      </div>

      {/* Charts */}
      <AnalyticsCharts data={chartData} />

      {/* Pass rates by type */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-5">Pass Rate by Test Type</h2>
        <div className="space-y-5">
          {passRates.map(({ label, pass, total }) => {
            const rate = total > 0 ? Math.round((pass / total) * 100) : 0
            const barColor = rate >= 80 ? 'bg-green-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500'
            const textColor = rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600'
            return (
              <div key={label}>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-eq-ink">{label}</span>
                  <span className={`font-bold text-lg ${textColor}`}>{rate}%</span>
                </div>
                <div className="relative h-8 bg-gray-100 rounded-lg overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-lg flex items-center justify-end pr-3 transition-all`}
                    style={{ width: `${Math.max(rate, 5)}%` }}
                  >
                    {rate > 15 && <span className="text-xs font-bold text-white">{pass}/{total}</span>}
                  </div>
                  {rate <= 15 && <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs font-bold text-eq-grey">{pass}/{total}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Maintenance Health + Instruments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Maintenance Health</h2>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-eq-grey">Checks completed (this month)</span>
                <span className={`text-sm font-bold ${checksChangePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {completedThisMonth} <span className="text-xs text-eq-grey">({checksChangePercent >= 0 ? '+' : ''}{checksChangePercent}%)</span>
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min((completedThisMonth / Math.max(checksThisMonth, 1)) * 100, 100)}%` }} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-eq-grey">Avg. time to complete</span>
              <span className="text-sm font-bold text-eq-ink">{avgTimeToComplete} days</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-eq-grey">Defect rate</span>
              <span className="text-sm font-bold text-eq-ink">{defectRate}%</span>
            </div>
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

      {/* Per-technician cut (S-W2-2) — checks completed / overdue / avg
          time-to-complete, honouring the customer + date-range filter. */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-4">By Technician</h2>
        {technicianRows.length === 0 ? (
          <p className="text-sm text-eq-grey">
            No assigned maintenance checks{selectedCustomerName ? ` for ${selectedCustomerName}` : ''}{rangeLabel ? ` in ${rangeLabel}` : ''}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold text-eq-grey uppercase tracking-wide border-b border-gray-100">
                  <th className="py-2 pr-4 font-bold">Technician</th>
                  <th className="py-2 px-4 font-bold text-right">Assigned</th>
                  <th className="py-2 px-4 font-bold text-right">Completed</th>
                  <th className="py-2 px-4 font-bold text-right">Overdue</th>
                  <th className="py-2 px-4 font-bold text-right">Completion</th>
                  <th className="py-2 pl-4 font-bold text-right">Avg days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {technicianRows.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-4 text-eq-ink font-medium">{t.name}</td>
                    <td className="py-2.5 px-4 text-right text-eq-ink">{t.total}</td>
                    <td className="py-2.5 px-4 text-right text-eq-ink">{t.completed}</td>
                    <td className={`py-2.5 px-4 text-right ${t.overdue > 0 ? 'text-red-600 font-medium' : 'text-eq-ink'}`}>{t.overdue}</td>
                    <td className={`py-2.5 px-4 text-right font-medium ${t.completionRate >= 80 ? 'text-green-600' : t.completionRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{t.completionRate}%</td>
                    <td className="py-2.5 pl-4 text-right text-eq-ink">{t.avgDays ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
