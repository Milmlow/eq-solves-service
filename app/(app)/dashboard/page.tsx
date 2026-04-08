import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/format'
import { AuSiteMap } from './AuSiteMap'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Get current user name
  const { data: { user } } = await supabase.auth.getUser()
  let userName = 'there'
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
    userName = profile?.full_name?.split(' ')[0] ?? 'there'
  }

  // Fetch all data in parallel
  const [
    customersRes, sitesRes, assetsRes, jobPlansRes,
    scheduledRes, inProgressRes, overdueRes, completeRes,
    upcomingChecks, recentChecks,
    sitesForMap,
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
    // Sites for map — group by state
    supabase.from('sites').select('id, name, state, city').eq('is_active', true),
  ])

  const entityStats = [
    { label: 'Sites', value: sitesRes.count ?? 0, href: '/sites', icon: '🏢' },
    { label: 'Assets', value: assetsRes.count ?? 0, href: '/assets', icon: '⚡' },
    { label: 'Job Plans', value: jobPlansRes.count ?? 0, href: '/job-plans', icon: '📋' },
    { label: 'Customers', value: customersRes.count ?? 0, href: '/customers', icon: '👥' },
  ]

  const checkCounts = {
    scheduled: scheduledRes.count ?? 0,
    inProgress: inProgressRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    complete: completeRes.count ?? 0,
  }
  const totalActive = checkCounts.scheduled + checkCounts.inProgress + checkCounts.overdue

  // Group sites by state for map
  const stateMap: Record<string, { count: number; sites: string[] }> = {}
  for (const site of sitesForMap.data ?? []) {
    const state = site.state ?? 'Unknown'
    if (!stateMap[state]) stateMap[state] = { count: 0, sites: [] }
    stateMap[state].count++
    stateMap[state].sites.push(site.name)
  }

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
          {checkCounts.overdue > 0 && (
            <span className="text-amber-600 font-medium"> {checkCounts.overdue} overdue.</span>
          )}
        </p>
      </div>

      {/* Quick KPIs — horizontal strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {entityStats.map(({ label, value, href, icon }) => (
          <Link key={label} href={href} className="block group">
            <Card className="group-hover:border-eq-sky/50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-eq-grey uppercase tracking-wide">{label}</p>
                  <p className="text-2xl font-bold text-eq-ink mt-1">{value.toLocaleString()}</p>
                </div>
                <span className="text-2xl opacity-60">{icon}</span>
              </div>
            </Card>
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
          <Link href="/maintenance?status=scheduled" className="rounded-lg bg-blue-50 p-3 text-center hover:bg-blue-100 transition-colors">
            <p className="text-2xl font-bold text-eq-deep">{checkCounts.scheduled}</p>
            <p className="text-xs text-eq-grey mt-0.5">Scheduled</p>
          </Link>
          <Link href="/maintenance?status=in_progress" className="rounded-lg bg-sky-50 p-3 text-center hover:bg-sky-100 transition-colors">
            <p className="text-2xl font-bold text-eq-sky">{checkCounts.inProgress}</p>
            <p className="text-xs text-eq-grey mt-0.5">In Progress</p>
          </Link>
          <Link href="/maintenance?status=overdue" className="rounded-lg bg-amber-50 p-3 text-center hover:bg-amber-100 transition-colors">
            <p className={`text-2xl font-bold ${checkCounts.overdue > 0 ? 'text-amber-600' : 'text-eq-grey'}`}>{checkCounts.overdue}</p>
            <p className="text-xs text-eq-grey mt-0.5">Overdue</p>
          </Link>
          <Link href="/maintenance?status=complete" className="rounded-lg bg-green-50 p-3 text-center hover:bg-green-100 transition-colors">
            <p className="text-2xl font-bold text-green-600">{checkCounts.complete}</p>
            <p className="text-xs text-eq-grey mt-0.5">Complete</p>
          </Link>
        </div>
      </Card>

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
            <div className="space-y-2">
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
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-700">Overdue</span>
                      )}
                      {isActive && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-100 text-eq-sky">Active</span>
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
            <div className="space-y-2">
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green-100 text-green-700">Done</span>
                      <span className="text-xs text-eq-grey">{formatDate(check.completed_at)}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Site Map */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-eq-ink">Sites by State</h2>
          <Link href="/sites" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all →</Link>
        </div>
        <AuSiteMap stateData={stateMap} />
      </Card>
    </div>
  )
}

function getGreeting(): string {
  const hour = new Date().getUTCHours() + 10 // AEST rough
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
