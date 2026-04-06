import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ReportFilters } from './ReportFilters'
import { BulkExportButton } from './BulkExportButton'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ site_id?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const siteId = params.site_id ?? ''
  const fromDate = params.from ?? ''
  const toDate = params.to ?? ''

  const supabase = await createClient()

  // Sites for filter
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // ────────── Maintenance stats ──────────
  let mCheckQuery = supabase.from('maintenance_checks').select('id, status, due_date, completed_at, site_id')
  if (siteId) mCheckQuery = mCheckQuery.eq('site_id', siteId)
  if (fromDate) mCheckQuery = mCheckQuery.gte('due_date', fromDate)
  if (toDate) mCheckQuery = mCheckQuery.lte('due_date', toDate)

  const { data: checks } = await mCheckQuery

  const mTotal = checks?.length ?? 0
  const mComplete = checks?.filter((c) => c.status === 'complete').length ?? 0
  const mOverdue = checks?.filter((c) => c.status === 'overdue').length ?? 0
  const mInProgress = checks?.filter((c) => c.status === 'in_progress').length ?? 0
  const mScheduled = checks?.filter((c) => c.status === 'scheduled').length ?? 0
  const mCancelled = checks?.filter((c) => c.status === 'cancelled').length ?? 0
  const mComplianceRate = mTotal > 0 ? Math.round((mComplete / mTotal) * 100) : 0

  // ────────── Testing stats ──────────
  let tRecordQuery = supabase.from('test_records').select('id, result, test_date, site_id').eq('is_active', true)
  if (siteId) tRecordQuery = tRecordQuery.eq('site_id', siteId)
  if (fromDate) tRecordQuery = tRecordQuery.gte('test_date', fromDate)
  if (toDate) tRecordQuery = tRecordQuery.lte('test_date', toDate)

  const { data: tests } = await tRecordQuery

  const tTotal = tests?.length ?? 0
  const tPass = tests?.filter((t) => t.result === 'pass').length ?? 0
  const tFail = tests?.filter((t) => t.result === 'fail').length ?? 0
  const tDefect = tests?.filter((t) => t.result === 'defect').length ?? 0
  const tPending = tests?.filter((t) => t.result === 'pending').length ?? 0
  const tPassRate = tTotal > 0 ? Math.round((tPass / tTotal) * 100) : 0

  // ────────── Overdue checks per site (top 5) ──────────
  const overdueChecksBySite: Record<string, number> = {}
  for (const c of checks ?? []) {
    if (c.status === 'overdue' && c.site_id) {
      overdueChecksBySite[c.site_id] = (overdueChecksBySite[c.site_id] ?? 0) + 1
    }
  }
  const siteMap = Object.fromEntries((sites ?? []).map((s) => [s.id, s.name]))
  const topOverdueSites = Object.entries(overdueChecksBySite)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ site: siteMap[id] ?? id, count }))

  // ────────── Recent failed tests (last 10) ──────────
  const failedTests = (tests ?? [])
    .filter((t) => t.result === 'fail' || t.result === 'defect')
    .sort((a, b) => new Date(b.test_date).getTime() - new Date(a.test_date).getTime())
    .slice(0, 10)

  // Resolve asset names for failed tests
  const failedTestIds = failedTests.map((t) => t.id)
  let failedTestDetails: { id: string; test_type: string; test_date: string; result: string; assets: { name: string } | null; sites: { name: string } | null }[] = []
  if (failedTestIds.length > 0) {
    const { data } = await supabase
      .from('test_records')
      .select('id, test_type, test_date, result, assets(name), sites(name)')
      .in('id', failedTestIds)
      .order('test_date', { ascending: false })
    failedTestDetails = (data ?? []) as unknown as typeof failedTestDetails
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Reports' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Compliance Reports</h1>
      </div>

      {/* Filters + Bulk Export */}
      <div className="flex items-center justify-between gap-4">
        <ReportFilters sites={sites ?? []} />
        <BulkExportButton sites={sites ?? []} />
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Maintenance Compliance</p>
          <p className={`text-3xl font-bold ${mComplianceRate >= 80 ? 'text-green-600' : mComplianceRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {mComplianceRate}%
          </p>
          <p className="text-xs text-eq-grey mt-1">{mComplete} of {mTotal} complete</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Overdue Checks</p>
          <p className={`text-3xl font-bold ${mOverdue > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {mOverdue}
          </p>
          <p className="text-xs text-eq-grey mt-1">requiring attention</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Test Pass Rate</p>
          <p className={`text-3xl font-bold ${tPassRate >= 80 ? 'text-green-600' : tPassRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
            {tPassRate}%
          </p>
          <p className="text-xs text-eq-grey mt-1">{tPass} of {tTotal} passed</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Test Defects</p>
          <p className={`text-3xl font-bold ${(tFail + tDefect) > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {tFail + tDefect}
          </p>
          <p className="text-xs text-eq-grey mt-1">{tFail} fail, {tDefect} defect</p>
        </Card>
      </div>

      {/* Two-column detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Maintenance breakdown */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Maintenance Check Breakdown</h2>
          <div className="space-y-3">
            <StatBar label="Complete" value={mComplete} total={mTotal} color="bg-green-500" />
            <StatBar label="In Progress" value={mInProgress} total={mTotal} color="bg-eq-sky" />
            <StatBar label="Scheduled" value={mScheduled} total={mTotal} color="bg-gray-300" />
            <StatBar label="Overdue" value={mOverdue} total={mTotal} color="bg-amber-500" />
            <StatBar label="Cancelled" value={mCancelled} total={mTotal} color="bg-gray-400" />
          </div>
        </Card>

        {/* Testing breakdown */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Test Result Breakdown</h2>
          <div className="space-y-3">
            <StatBar label="Pass" value={tPass} total={tTotal} color="bg-green-500" />
            <StatBar label="Pending" value={tPending} total={tTotal} color="bg-gray-300" />
            <StatBar label="Fail" value={tFail} total={tTotal} color="bg-red-500" />
            <StatBar label="Defect" value={tDefect} total={tTotal} color="bg-amber-500" />
          </div>
        </Card>
      </div>

      {/* Bottom tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overdue by site */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Overdue Checks by Site</h2>
          {topOverdueSites.length === 0 ? (
            <p className="text-sm text-eq-grey">No overdue checks — all clear.</p>
          ) : (
            <div className="space-y-2">
              {topOverdueSites.map(({ site, count }) => (
                <div key={site} className="flex items-center justify-between text-sm">
                  <span className="text-eq-ink">{site}</span>
                  <span className="font-bold text-amber-600">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent failed tests */}
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4">Recent Failed / Defect Tests</h2>
          {failedTestDetails.length === 0 ? (
            <p className="text-sm text-eq-grey">No failed tests in this period.</p>
          ) : (
            <div className="space-y-2">
              {failedTestDetails.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-eq-ink font-medium">{t.assets?.name ?? '—'}</span>
                    <span className="text-eq-grey text-xs ml-2">{t.test_type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-eq-grey">{new Date(t.test_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}</span>
                    <span className={`text-xs font-bold uppercase ${t.result === 'fail' ? 'text-red-600' : 'text-amber-600'}`}>
                      {t.result}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function StatBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-eq-grey">{label}</span>
        <span className="font-bold text-eq-ink">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
