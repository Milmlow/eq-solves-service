import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/format'
import { SiteMapDynamic } from './SiteMapDynamic'
import type { MapSite } from './SiteMapLeaflet'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Get current user name
  const { data: { user } } = await supabase.auth.getUser()
  let userName = 'there'
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    userName = profile?.full_name?.split(' ')[0] ?? 'there'
  }

  // Fetch all data in parallel
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
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'overdue'),
    supabase.from('maintenance_checks').select('*', { count: 'exact', head: true }).eq('status', 'complete'),
    // Upcoming: scheduled + in_progress + overdue, ordered by due date
    supabase.from('maintenance_checks')
      .select('id, custom_name, status, due_date, sites(name)')
      .in('status', ['scheduled', 'in_progress', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(8),
    // Recently completed
    supabase.from('maintenance_checks')
      .select('id, custom_name, status, completed_at, sites(name)')
      .eq('status', 'complete')
      .order('completed_at', { ascending: false })
      .limit(6),
    // Sites for map — include coordinates, customer name.
    // NOTE: active asset counts are fetched in a second query below because
    // PostgREST's embedded `assets(count)` ignores the `is_active` filter
    // and inflates the per-pin totals by including archived assets.
    supabase.from('sites')
      .select('id, name, state, city, latitude, longitude, customer_id, customers(name)')
      .eq('is_active', true),
    // Defect counts by severity
    supabase.from('defects').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'critical').in('status', ['open', 'in_progress']),
    supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'high').in('status', ['open', 'in_progress']),
    supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'medium').in('status', ['open', 'in_progress']),
    supabase.from('defects').select('*', { count: 'exact', head: true }).eq('severity', 'low').in('status', ['open', 'in_progress']),
  ])

  const entityStats = [
    { label: 'Sites', value: sitesRes.count ?? 0, href: '/sites', colour: 'from-sky-500 to-sky-600', bgLight: 'bg-sky-50', textColour: 'text-sky-700' },
    { label: 'Assets', value: assetsRes.count ?? 0, href: '/assets', colour: 'from-eq-sky to-eq-deep', bgLight: 'bg-blue-50', textColour: 'text-blue-700' },
    { label: 'Job Plans', value: jobPlansRes.count ?? 0, href: '/job-plans', colour: 'from-indigo-500 to-indigo-600', bgLight: 'bg-indigo-50', textColour: 'text-indigo-700' },
    { label: 'Customers', value: customersRes.count ?? 0, href: '/customers', colour: 'from-violet-500 to-violet-600', bgLight: 'bg-violet-50', textColour: 'text-violet-700' },
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

  // Fetch active asset counts per site — separate query so the
  // `is_active = true` filter is actually applied (unlike embedded
  // `assets(count)` which ignores it and inflates the totals).
  const mapSiteIds = (sitesForMap.data ?? []).map((s) => s.id as string)
  const mapCountMap = new Map<string, number>()
  if (mapSiteIds.length > 0) {
    const { data: assetRows } = await supabase
      .from('assets')
      .select('site_id')
      .eq('is_active', true)
      .in('site_id', mapSiteIds)
    for (const row of assetRows ?? []) {
      const sid = row.site_id as string | null
      if (!sid) continue
      mapCountMap.set(sid, (mapCountMap.get(sid) ?? 0) + 1)
    }
  }

  // Build map sites data
  const mapSites: MapSite[] = (sitesForMap.data ?? []).map((site) => {
    const customerName = (site.customers as unknown as { name: string } | null)?.name ?? null
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

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold text-eq-ink">Good {getGreeting()}, {userName}</h1>
        <p className="text-sm text-eq-grey mt-1">
          {totalActive > 0
            ? `You have ${totalActive} active maintenance ${totalActive === 1 ? 'check' : 'checks'} across your sites.`
            : 'All maintenance checks are up to date.'
          }
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
                {checkCounts.overdue} overdue {checkCounts.overdue === 1 ? 'check' : 'checks'} need attention
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Click to view and action overdue maintenance checks</p>
            </div>
            <span className="text-amber-400 text-sm font-medium shrink-0">View →</span>
          </div>
        </Link>
      )}

      {/* Quick KPIs — coloured accent strip */}
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

      {/* Maintenance status bar */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-eq-ink">Maintenance Overview</h2>
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

      {/* Defect Summary + Map — side by side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Defect Summary */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-eq-ink">Open Defects</h2>
            <span className="text-xs text-eq-grey">{defectCounts.total} total</span>
          </div>
          {defectCounts.total === 0 ? (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
                <span className="text-green-500 text-lg">✓</span>
              </div>
              <p className="text-sm text-eq-grey">No open defects</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Severity bars */}
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

        {/* Interactive Map */}
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
            <h2 className="text-sm font-bold text-eq-ink">Upcoming Works</h2>
            <Link href="/maintenance?status=scheduled" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
          </div>
          {(upcomingChecks.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-eq-grey py-4 text-center">No upcoming checks</p>
          ) : (
            <div className="space-y-1">
              {(upcomingChecks.data ?? []).map(check => {
                const siteName = (check.sites as unknown as { name: string } | null)?.name ?? '—'
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
                      {isOverdue && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700">Overdue</span>
                      )}
                      {isActive && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-100 text-eq-sky">Active</span>
                      )}
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
            <h2 className="text-sm font-bold text-eq-ink">Recently Completed</h2>
            <Link href="/maintenance?status=complete" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
          </div>
          {(recentChecks.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-eq-grey py-4 text-center">No completed checks yet</p>
          ) : (
            <div className="space-y-1">
              {(recentChecks.data ?? []).map(check => {
                const siteName = (check.sites as unknown as { name: string } | null)?.name ?? '—'
                return (
                  <Link key={check.id} href={`/maintenance/${check.id}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-eq-ink truncate">{check.custom_name ?? siteName}</p>
                      <p className="text-xs text-eq-grey">{siteName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-green-100 text-green-700">Done</span>
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

function getGreeting(): string {
  const hour = new Date().getUTCHours() + 10 // AEST rough
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
