/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /admin/today — supervisor "where is everyone right now" view.
 *
 * Lists every maintenance check due today (or overdue), grouped by
 * status, with the assigned tech, arrival timestamp + GPS coords if
 * captured, and an "Open in Maps" deep link centred on the actual
 * arrival point.
 *
 * Designed to sit on a screen at HQ during the onboarding day — Royce
 * watches the bar move from "Not started" to "Onsite" to "Complete"
 * as the team works. Same data is also useful any day after.
 *
 * Refreshes every 30 seconds via Next's revalidate.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { createClient } from '@/lib/supabase/server'
import { MapPin, Navigation, Clock, CheckCircle2, AlertCircle, Activity } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const revalidate = 30

type CheckRow = {
  id: string
  custom_name: string | null
  status: string
  due_date: string
  started_at: string | null
  completed_at: string | null
  assigned_to: string | null
  gps_lat: number | null
  gps_lng: number | null
  sites: { name: string; address: string | null; city: string | null; state: string | null } | null
  job_plans: { name: string } | null
}

type ProfileRow = { id: string; full_name: string | null; email: string | null }

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (isNaN(diffMs)) return '—'
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function mapHref(lat: number | null, lng: number | null, fallback: string | null): string | null {
  if (lat !== null && lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  }
  if (fallback) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallback)}`
  }
  return null
}

export default async function TodaySupervisorPage() {
  const supabase = await createClient()
  const todayIso = new Date().toISOString().slice(0, 10)

  // Pull every check due today OR overdue OR in progress, plus today's
  // completions so the bar shows the full picture as the day unfolds.
  // 100-row cap is overkill (real days run <20) but cheap.
  const { data: checksRaw } = await supabase
    .from('maintenance_checks')
    .select(`
      id, custom_name, status, due_date, started_at, completed_at,
      assigned_to, gps_lat, gps_lng,
      sites(name, address, city, state),
      job_plans(name)
    `)
    .or(`due_date.lte.${todayIso},status.eq.in_progress`)
    .eq('is_active', true)
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true })
    .limit(100)

  const checks = (checksRaw ?? []) as unknown as CheckRow[]

  // Group by status — "Onsite now" is the highlight band.
  const inProgress = checks.filter((c) => c.status === 'in_progress')
  const scheduled = checks.filter((c) => c.status === 'scheduled' || c.status === 'overdue')
  const complete = checks.filter((c) => c.status === 'complete' && c.completed_at &&
    new Date(c.completed_at).toISOString().slice(0, 10) === todayIso)

  // Resolve assignee names.
  const userIds = Array.from(new Set(checks.map((c) => c.assigned_to).filter((v): v is string => v !== null)))
  const { data: profilesRaw } = userIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [] as ProfileRow[] }
  const profileById = new Map<string, ProfileRow>((profilesRaw ?? []).map((p) => [p.id, p]))

  function whoFor(userId: string | null): string {
    if (!userId) return 'Unassigned'
    const p = profileById.get(userId)
    if (!p) return 'Someone'
    return p.full_name?.split(' ')[0] ?? p.email?.split('@')[0] ?? userId.slice(0, 8)
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Admin', href: '/admin' },
          { label: 'Today' },
        ]} />
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-eq-ink">Today</h1>
            <p className="text-sm text-eq-grey mt-1">
              Where everyone is right now. Refreshes every 30 seconds.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      {/* Status bar — counts at a glance */}
      <div className="grid grid-cols-3 gap-3">
        <StatusTile
          icon={Activity}
          tone="amber"
          label="Onsite now"
          count={inProgress.length}
        />
        <StatusTile
          icon={Clock}
          tone="sky"
          label="Not started"
          count={scheduled.length}
        />
        <StatusTile
          icon={CheckCircle2}
          tone="emerald"
          label="Done today"
          count={complete.length}
        />
      </div>

      {/* Onsite now — the highlight band */}
      <section>
        <h2 className="text-sm font-bold text-eq-grey uppercase tracking-wider mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-amber-600" />
          Onsite now ({inProgress.length})
        </h2>
        {inProgress.length === 0 ? (
          <Card>
            <p className="p-5 text-sm text-eq-grey italic text-center">
              Nobody onsite yet. As soon as a tech taps Start Check, they'll appear here.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {inProgress.map((c) => <CheckRowItem key={c.id} check={c} who={whoFor(c.assigned_to)} highlight />)}
          </div>
        )}
      </section>

      {/* Scheduled */}
      <section>
        <h2 className="text-sm font-bold text-eq-grey uppercase tracking-wider mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-eq-sky" />
          Not started yet ({scheduled.length})
        </h2>
        {scheduled.length === 0 ? (
          <Card>
            <p className="p-5 text-sm text-eq-grey italic text-center">No checks waiting.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {scheduled.map((c) => <CheckRowItem key={c.id} check={c} who={whoFor(c.assigned_to)} />)}
          </div>
        )}
      </section>

      {/* Done today */}
      <section>
        <h2 className="text-sm font-bold text-eq-grey uppercase tracking-wider mb-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          Done today ({complete.length})
        </h2>
        {complete.length === 0 ? (
          <Card>
            <p className="p-5 text-sm text-eq-grey italic text-center">Nothing complete yet today.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {complete.map((c) => <CheckRowItem key={c.id} check={c} who={whoFor(c.assigned_to)} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function StatusTile({ icon: Icon, tone, label, count }: {
  icon: typeof Activity
  tone: 'amber' | 'sky' | 'emerald'
  label: string
  count: number
}) {
  const palette: Record<typeof tone, { bg: string; fg: string }> = {
    amber: { bg: 'bg-amber-50 border-amber-200', fg: 'text-amber-700' },
    sky: { bg: 'bg-sky-50 border-sky-200', fg: 'text-sky-700' },
    emerald: { bg: 'bg-emerald-50 border-emerald-200', fg: 'text-emerald-700' },
  }
  const p = palette[tone]
  return (
    <div className={`rounded-xl border ${p.bg} p-4`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${p.fg}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${p.fg}`}>{label}</span>
      </div>
      <p className={`text-3xl font-bold ${p.fg}`}>{count}</p>
    </div>
  )
}

function CheckRowItem({ check, who, highlight }: { check: CheckRow; who: string; highlight?: boolean }) {
  const siteName = check.sites?.name ?? '—'
  const siteAddress = [check.sites?.address, check.sites?.city, check.sites?.state].filter(Boolean).join(', ') || null
  const planName = check.job_plans?.name ?? null
  const arrivedAgo = check.started_at ? timeAgo(check.started_at) : null
  const completedAgo = check.completed_at ? timeAgo(check.completed_at) : null
  const map = mapHref(check.gps_lat, check.gps_lng, siteAddress)
  const hasGps = check.gps_lat !== null && check.gps_lng !== null

  return (
    <Link
      href={`/maintenance/${check.id}`}
      className={`block rounded-lg border bg-white p-4 hover:border-eq-sky transition-colors ${
        highlight ? 'border-amber-200 ring-1 ring-amber-100' : 'border-eq-line'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-eq-ink">{siteName}</span>
            <StatusBadge status={
              check.status === 'in_progress' ? 'in-progress' :
              check.status === 'overdue' ? 'overdue' :
              check.status === 'complete' ? 'complete' :
              'not-started'
            } size="sm" />
            {hasGps && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                <MapPin className="w-2.5 h-2.5" />
                Onsite
              </span>
            )}
          </div>
          <p className="text-xs text-eq-grey mt-1 truncate">
            {check.custom_name ?? planName ?? 'Maintenance check'}
            {' · '}
            {who}
          </p>
          {arrivedAgo && check.status === 'in_progress' && (
            <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Started {arrivedAgo}
            </p>
          )}
          {completedAgo && check.status === 'complete' && (
            <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Completed {completedAgo}
            </p>
          )}
          {check.status === 'overdue' && (
            <p className="text-xs text-red-700 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Overdue — due {new Date(check.due_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
            </p>
          )}
        </div>
        {map && (
          <a
            href={map}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md border border-eq-line text-eq-deep hover:bg-eq-ice transition-colors"
            title="Open in Maps"
            aria-label="Open in Maps"
          >
            <Navigation className="w-4 h-4" />
          </a>
        )}
      </div>
    </Link>
  )
}
