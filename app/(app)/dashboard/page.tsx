import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/format'
import { firstRow } from '@/lib/db/relation'
import { SiteMapDynamic } from './SiteMapDynamic'
import type { MapSite } from './SiteMapLeaflet'
import type { Role } from '@/lib/types'
import { DashboardViewToggle } from './DashboardViewToggle'
import { DashboardAnalytics } from './DashboardAnalytics'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ServiceCreditWidget } from './ServiceCreditWidget'

type View = 'mine' | 'all'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  // ── Resolve user, role, profile ──
  const { data: { user } } = await supabase.auth.getUser()
  let userName = 'there'
  let userRole: Role = 'read_only'
  let userId: string | null = null

  let tenantId: string | null = null
  if (user) {
    userId = user.id
    const [{ data: profile }, { data: membership }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      supabase
        .from('tenant_members')
        .select('role, tenant_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
    ])
    userName = profile?.full_name?.split(' ')[0] ?? 'there'
    userRole = (membership?.role as Role) ?? 'read_only'
    tenantId = (membership?.tenant_id as string | undefined) ?? null
  }

  // Commercial-features flag — gates the service-credit widget. Single
  // small read; lives outside the big Promise.all so the widget can be a
  // server component without re-querying.
  let commercialEnabled = false
  if (tenantId) {
    const { data: settings } = await supabase
      .from('tenant_settings')
      .select('commercial_features_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    commercialEnabled = Boolean(
      (settings as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled,
    )
  }

  // ── Determine effective view based on role + param ──
  const canToggle = userRole !== 'technician' && userRole !== 'read_only'
  const defaultView: View = userRole === 'super_admin' || userRole === 'admin' ? 'all' : 'mine'
  const effectiveView: View = canToggle && (params.view === 'mine' || params.view === 'all')
    ? params.view
    : canToggle
      ? defaultView
      : 'mine'

  const filterByUser = effectiveView === 'mine' && userId

  // ── Fetch all data in parallel ──
  // Entity stats are always tenant-wide (context, not tasks)
  const [
    customersRes, sitesRes, assetsRes, jobPlansRes,
    scheduledRes, inProgressRes, overdueRes, completeRes,
    upcomingChecks, recentChecks,
    sitesForMap,
    defectsOpen, defectsCritical, defectsHigh, defectsMedium, defectsLow,
  ] = await Promise.all([
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('sites').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('assets').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('job_plans').select('*', { count: 'exact', head: true }).eq('is_active', true),
    // Maintenance counts — optionally filtered by assigned_to; exclude archived (is_active = false)
    buildCountQuery(supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('status', 'scheduled'), filterByUser, userId),
    buildCountQuery(supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('status', 'in_progress'), filterByUser, userId),
    buildCountQuery(supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('status', 'overdue'), filterByUser, userId),
    buildCountQuery(supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('status', 'complete'), filterByUser, userId),
    // Upcoming checks
    buildListQuery(
      supabase.from('maintenance_checks')
        .select('id, custom_name, status, due_date, sites(name)')
        .eq('is_active', true)
        .in('status', ['scheduled', 'in_progress', 'overdue'])
        .order('due_date', { ascending: true })
        .limit(8),
      filterByUser, userId,
    ),
    // Recently completed
    buildListQuery(
      supabase.from('maintenance_checks')
        .select('id, custom_name, status, completed_at, sites(name)')
        .eq('is_active', true)
        .eq('status', 'complete')
        .order('completed_at', { ascending: false })
        .limit(6),
      filterByUser, userId,
    ),
    // Sites for map — always tenant-wide
    supabase.from('sites')
      .select('id, name, state, city, latitude, longitude, customer_id, customers(name)')
      .eq('is_active', true),
    // Defect counts — optionally filtered by raised_by
    buildDefectCountQuery(supabase.from('defects').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']), filterByUser, userId),
    buildDefectCountQuery(supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'critical').in('status', ['open', 'in_progress']), filterByUser, userId),
    buildDefectCountQuery(supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'high').in('status', ['open', 'in_progress']), filterByUser, userId),
    buildDefectCountQuery(supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'medium').in('status', ['open', 'in_progress']), filterByUser, userId),
    buildDefectCountQuery(supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'low').in('status', ['open', 'in_progress']), filterByUser, userId),
  ])

  // ── My in-progress tests (ACB + NSX) — only when view=mine ──
  type TestRow = { id: string; test_date: string; overall_result: string; assets: { name: string } | { name: string }[] | null; sites: { name: string } | { name: string }[] | null }
  let myAcbTests: TestRow[] = []
  let myNsxTests: TestRow[] = []

  if (filterByUser) {
    const [acbRes, nsxRes] = await Promise.all([
      supabase
        .from('acb_tests')
        .select('id, test_date, overall_result, assets(name), sites(name)')
        .eq('tested_by', userId!)
        .eq('is_active', true)
        .neq('overall_result', 'Pass')
        .order('test_date', { ascending: false })
        .limit(6),
      supabase
        .from('nsx_tests')
        .select('id, test_date, overall_result, assets(name), sites(name)')
        .eq('tested_by', userId!)
        .eq('is_active', true)
        .neq('overall_result', 'Pass')
        .order('test_date', { ascending: false })
        .limit(6),
    ])
    myAcbTests = (acbRes.data ?? []) as unknown as TestRow[]
    myNsxTests = (nsxRes.data ?? []) as unknown as TestRow[]
  }

  const entityStats = [
    { label: 'Sites', value: sitesRes.count ?? 0, href: '/sites', bgLight: 'bg-sky-50', textColour: 'text-sky-700' },
    { label: 'Assets', value: assetsRes.count ?? 0, href: '/assets', bgLight: 'bg-blue-50', textColour: 'text-blue-700' },
    { label: 'Job Plans', value: jobPlansRes.count ?? 0, href: '/job-plans', bgLight: 'bg-indigo-50', textColour: 'text-indigo-700' },
    { label: 'Customers', value: customersRes.count ?? 0, href: '/customers', bgLight: 'bg-violet-50', textColour: 'text-violet-700' },
  ]

  const checkCounts = {
    scheduled: scheduledRes.count ?? 0,
    inProgress: inProgressRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    complete: completeRes.count ?? 0,
  }
  const totalActive = checkCounts.scheduled + checkCounts.inProgress + checkCounts.overdue

  const defectCounts = {
    total: defectsOpen.count ?? 0,
    critical: defectsCritical.count ?? 0,
    high: defectsHigh.count ?? 0,
    medium: defectsMedium.count ?? 0,
    low: defectsLow.count ?? 0,
  }

  // ── Active asset counts per site (for map pins) ──
  const mapSiteIds = (sitesForMap.data ?? []).map((s) => s.id as string)
  const mapCountMap = new Map<string, number>()
  if (mapSiteIds.length > 0) {
    const { data: countRows } = await supabase
      .rpc('get_active_asset_counts_by_site', { p_site_ids: mapSiteIds })
    for (const row of (countRows ?? []) as Array<{ site_id: string; asset_count: number }>) {
      mapCountMap.set(row.site_id, Number(row.asset_count))
    }
  }

  const mapSites: MapSite[] = (sitesForMap.data ?? []).map((site) => {
    const customerName = firstRow(site.customers as { name: string } | { name: string }[] | null)?.name ?? null
    return {
      id: site.id,
      name: site.name,
      state: site.state,
      city: site.city,
      latitude: site.latitude,
      longitude: site.longitude,
      customer_name: customerName,
      asset_count: mapCountMap.get(site.id as string) ?? 0,
    }
  })

  const myTestsTotal = myAcbTests.length + myNsxTests.length

  return (
    <div className="space-y-6">
      {/* Analytics: dashboard_viewed (fires once per mount, client-side) */}
      <DashboardAnalytics siteCount={sitesRes.count ?? 0} openChecksCount={totalActive} />

      {/* Welcome header — view toggle (if available) lives inline in the subtitle,
          not as a separate top-right pill. Keeps the dashboard header clean now
          that the global plan chip has moved into the sidebar footer. */}
      <div>
        <h1 className="text-2xl font-bold text-eq-ink">Good {getGreeting()}, {userName}</h1>
        <p className="text-sm text-eq-grey mt-1">
          {effectiveView === 'mine'
            ? totalActive > 0
              ? `You have ${totalActive} active ${totalActive === 1 ? 'check' : 'checks'} assigned to you.`
              : 'You have no active checks assigned.'
            : totalActive > 0
              ? `${totalActive} active maintenance ${totalActive === 1 ? 'check' : 'checks'} across all sites.`
              : 'All maintenance checks are up to date.'
          }
          {canToggle && (
            <>
              {' · '}
              <DashboardViewToggle currentView={effectiveView} />
            </>
          )}
        </p>
      </div>

      {/* Overdue alert banner */}
      {checkCounts.overdue > 0 && (
        <Link href="/maintenance?status=overdue" className="block">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-300 transition-colors">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <span className="text-lg">⚠️</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">
                {checkCounts.overdue} overdue {checkCounts.overdue === 1 ? 'check' : 'checks'} need{effectiveView === 'mine' ? ' your' : ''} attention
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Click to view and action overdue maintenance checks</p>
            </div>
            <span className="text-amber-400 text-sm font-medium shrink-0">View →</span>
          </div>
        </Link>
      )}

      {/* Quick KPIs — always tenant-wide */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {entityStats.map(({ label, value, href, bgLight, textColour }) => (
          <Link key={label} href={href} className="block group">
            <div className={`${bgLight} rounded-xl p-4 border border-transparent group-hover:border-eq-sky/30 transition-all group-hover:shadow-sm`}>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide">{label}</p>
              <p className={`text-3xl font-bold ${textColour} mt-1`}>{value.toLocaleString()}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* My Tests — shown when view=mine and there are in-progress tests */}
      {filterByUser && myTestsTotal > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-eq-ink">My In-Progress Tests</h2>
            <Link href="/testing" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
          </div>
          <div className="space-y-1">
            {[...myAcbTests.map(t => ({ ...t, kind: 'ACB' })), ...myNsxTests.map(t => ({ ...t, kind: 'NSX' }))].map(test => {
              const assetName = firstRow(test.assets as { name: string } | { name: string }[] | null)?.name ?? '—'
              const siteName = firstRow(test.sites as { name: string } | { name: string }[] | null)?.name ?? ''
              const isDefect = test.overall_result === 'Defect'
              const isPending = test.overall_result === 'Pending'
              return (
                <Link
                  key={test.id}
                  href={`/testing/${test.kind.toLowerCase()}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-eq-ink truncate">{assetName}</p>
                    <p className="text-xs text-eq-grey">{siteName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-eq-grey">{test.kind}</span>
                    {isDefect && <StatusBadge status="blocked" label="Defect" />}
                    {isPending && <StatusBadge status="not-started" label="Pending" />}
                    <span className="text-xs text-eq-grey">{formatDate(test.test_date)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Maintenance status bar */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-eq-ink">Maintenance Overview{effectiveView === 'mine' ? ' — My Checks' : ''}</h2>
          <Link href="/maintenance" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Link href="/maintenance?status=scheduled" className="rounded-lg bg-blue-50 p-3 text-center hover:bg-blue-100 transition-colors border border-blue-100">
            <p className="text-2xl font-bold text-eq-deep">{checkCounts.scheduled}</p>
            <p className="text-xs text-eq-grey mt-0.5">Scheduled</p>
          </Link>
          <Link href="/maintenance?status=in_progress" className="rounded-lg bg-sky-50 p-3 text-center hover:bg-sky-100 transition-colors border border-sky-100">
            <p className="text-2xl font-bold text-eq-sky">{checkCounts.inProgress}</p>
            <p className="text-xs text-eq-grey mt-0.5">In Progress</p>
          </Link>
          <Link href="/maintenance?status=overdue" className="rounded-lg bg-amber-50 p-3 text-center hover:bg-amber-100 transition-colors border border-amber-100">
            <p className={`text-2xl font-bold ${checkCounts.overdue > 0 ? 'text-amber-600' : 'text-eq-grey'}`}>{checkCounts.overdue}</p>
            <p className="text-xs text-eq-grey mt-0.5">Overdue</p>
          </Link>
          <Link href="/maintenance?status=complete" className="rounded-lg bg-green-50 p-3 text-center hover:bg-green-100 transition-colors border border-green-100">
            <p className="text-2xl font-bold text-green-600">{checkCounts.complete}</p>
            <p className="text-xs text-eq-grey mt-0.5">Complete</p>
          </Link>
        </div>
      </Card>

      {/* Service-credit risk — Phase 6 of the contract-scope bridge plan.
          Only renders for tenants on the commercial tier; the widget is a
          server component that fetches its own data so the dashboard
          page.tsx stays focused on the always-on KPIs. */}
      {commercialEnabled && tenantId && (
        <ServiceCreditWidget tenantId={tenantId} />
      )}

      {/* Defect Summary + Map — side by side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Defect Summary */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-eq-ink">{effectiveView === 'mine' ? 'My Open Defects' : 'Open Defects'}</h2>
            <span className="text-xs text-eq-grey">{defectCounts.total} total</span>
          </div>
          {defectCounts.total === 0 ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
                <span className="text-green-500 text-lg">✓</span>
              </div>
              <p className="text-sm text-eq-grey">{effectiveView === 'mine' ? 'No defects raised by you' : 'No open defects'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { label: 'Critical', count: defectCounts.critical, bg: 'bg-red-500', bgLight: 'bg-red-50', text: 'text-red-700' },
                { label: 'High', count: defectCounts.high, bg: 'bg-orange-500', bgLight: 'bg-orange-50', text: 'text-orange-700' },
                { label: 'Medium', count: defectCounts.medium, bg: 'bg-amber-400', bgLight: 'bg-amber-50', text: 'text-amber-700' },
                { label: 'Low', count: defectCounts.low, bg: 'bg-sky-400', bgLight: 'bg-sky-50', text: 'text-sky-700' },
              ].map(({ label, count, bg, bgLight, text }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${text}`}>{label}</span>
                    <span className={`text-xs font-bold ${text}`}>{count}</span>
                  </div>
                  <div className={`h-2 rounded-full ${bgLight} overflow-hidden`}>
                    <div
                      className={`h-full rounded-full ${bg} transition-all duration-500`}
                      style={{ width: defectCounts.total > 0 ? `${Math.max((count / defectCounts.total) * 100, count > 0 ? 8 : 0)}%` : '0%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Interactive Map — always tenant-wide */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-eq-ink">Site Locations</h2>
              <Link href="/sites" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
            </div>
            <SiteMapDynamic sites={mapSites} />
          </Card>
        </div>
      </div>

      {/* Upcoming works + Recently completed — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Works */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-eq-ink">{effectiveView === 'mine' ? 'My Upcoming Works' : 'Upcoming Works'}</h2>
            <Link href="/maintenance?status=scheduled" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
          </div>
          {(upcomingChecks.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-eq-grey py-4 text-center">{effectiveView === 'mine' ? 'No checks assigned to you' : 'No upcoming checks'}</p>
          ) : (
            <div className="space-y-1">
              {(upcomingChecks.data ?? []).map((check: { id: string; custom_name: string | null; status: string; due_date: string; sites: unknown }) => {
                const siteName = firstRow(check.sites as { name: string } | { name: string }[] | null)?.name ?? '—'
                const isOverdue = check.status === 'overdue'
                const isActive = check.status === 'in_progress'
                return (
                  <Link key={check.id} href={`/maintenance/${check.id}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100 group">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-eq-ink truncate">{check.custom_name ?? siteName}</p>
                      <p className="text-xs text-eq-grey">{siteName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {isOverdue && <StatusBadge status="overdue" />}
                      {isActive && <StatusBadge status="in-progress" label="Active" />}
                      <span className="text-xs text-eq-grey">{formatDate(check.due_date)}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        {/* Recently Completed */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-eq-ink">{effectiveView === 'mine' ? 'My Recently Completed' : 'Recently Completed'}</h2>
            <Link href="/maintenance?status=complete" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
          </div>
          {(recentChecks.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-eq-grey py-4 text-center">{effectiveView === 'mine' ? 'No completed checks yet' : 'No completed checks yet'}</p>
          ) : (
            <div className="space-y-1">
              {(recentChecks.data ?? []).map((check: { id: string; custom_name: string | null; status: string; completed_at: string; sites: unknown }) => {
                const siteName = firstRow(check.sites as { name: string } | { name: string }[] | null)?.name ?? '—'
                return (
                  <Link key={check.id} href={`/maintenance/${check.id}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-eq-ink truncate">{check.custom_name ?? siteName}</p>
                      <p className="text-xs text-eq-grey">{siteName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <StatusBadge status="complete" label="Done" />
                      <span className="text-xs text-eq-grey">{formatDate(check.completed_at)}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Helpers ──

function getGreeting(): string {
  const hour = new Date().getUTCHours() + 10 // AEST rough
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/**
 * Conditionally add `assigned_to` filter for maintenance_checks queries.
 * Works with both count queries and list queries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCountQuery(query: any, filterByUser: string | false | null, userId: string | null) {
  if (filterByUser && userId) return query.eq('assigned_to', userId)
  return query
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildListQuery(query: any, filterByUser: string | false | null, userId: string | null) {
  if (filterByUser && userId) return query.eq('assigned_to', userId)
  return query
}

/**
 * Conditionally add `raised_by` filter for defect queries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDefectCountQuery(query: any, filterByUser: string | false | null, userId: string | null) {
  if (filterByUser && userId) return query.eq('raised_by', userId)
  return query
}
