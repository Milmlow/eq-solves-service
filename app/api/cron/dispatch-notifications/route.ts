/**
 * /api/cron/dispatch-notifications
 *
 * Single endpoint pg_cron hits every 15 minutes. Dispatches:
 *
 *   - **Supervisor digest** to each user whose effective preferences
 *     (notification_preferences cascade) say "deliver digest at this
 *     time, on this day-of-week, in this timezone" — Outlook-invite
 *     style customisation.
 *
 *   - **Pre-due reminders** (Phase B) — checks where due_date - today
 *     matches the user's pre_due_reminder_days array (e.g. {14,7,1}).
 *
 *   - **Customer monthly summary** (Phase C, commercial-tier only) —
 *     fires for customer contacts whose monthly_summary_day matches
 *     today's day-of-month.
 *
 *   - **Customer upcoming-visit notice** (Phase C) — fires 7 days
 *     before a scheduled maintenance check.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`. Same secret the existing
 * /api/cron/supervisor-digest endpoint uses; pg_cron passes it via
 * pg_net.http_post.
 *
 * The endpoint is idempotent in the sense that triggering it multiple
 * times in the same 15-minute window won't double-send: the matching
 * window is "current 15-min slot" and digest_time is stored at minute
 * granularity, so only one slot per day matches each user.
 *
 * Per-user errors don't fail the request — the response includes
 * per-tenant counts, errors are logged in the per-feature audit tables
 * (supervisor_digests for digests, etc.).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSupervisorDigests } from '@/lib/calendar/supervisor-digest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function resolveAppUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    req.nextUrl.origin
  )
}

const DOW_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

interface PrefRow {
  user_id: string | null
  digest_time: string  // 'HH:MM:SS' from Postgres time
  digest_days: string[]
  pre_due_reminder_days: number[]
  event_type_opt_outs: string[]
  bell_enabled: boolean
  email_enabled: boolean
  digest_enabled: boolean
  timezone: string
}

/**
 * Compute the user's "now" — what hour:minute is it where they are?
 * Returns the local hour and minute, plus the local DOW string (mon/tue/etc).
 */
function nowInTz(tz: string): { hour: number; minute: number; dow: string; dayOfMonth: number } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    day: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  const weekdayShort = (parts.find(p => p.type === 'weekday')?.value ?? 'Mon').toLowerCase().slice(0, 3)
  const day = Number(parts.find(p => p.type === 'day')?.value ?? '1')
  return { hour, minute, dow: weekdayShort, dayOfMonth: day }
}

/**
 * Matches "is the current 15-min slot the user's digest slot?"
 * digest_time '07:00' matches local 07:00..07:14.
 * digest_time '07:30' matches local 07:30..07:44.
 */
function isUserDigestSlot(prefs: PrefRow): boolean {
  if (!prefs.digest_enabled || !prefs.email_enabled) return false
  const { hour, minute, dow } = nowInTz(prefs.timezone)
  if (!prefs.digest_days.includes(dow)) return false
  const [prefHourStr, prefMinStr] = prefs.digest_time.split(':')
  const prefHour = Number(prefHourStr)
  const prefMin = Number(prefMinStr)
  if (hour !== prefHour) return false
  // 15-minute slot match — current minute should be within [prefMin, prefMin+15).
  return minute >= prefMin && minute < prefMin + 15
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured on server' },
      { status: 500 },
    )
  }
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const debugFlag = url.searchParams.get('debug') === '1'
  const forceUserId = url.searchParams.get('force_user_id')  // bypass time-match for testing
  const appUrl = resolveAppUrl(req)
  const supabase = createAdminClient()

  const summary: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    appUrl,
    sections: {
      overdueFlip: { flipped: 0, notified: 0, errors: 0 },
      supervisorDigest: { eligible: 0, sent: 0, errors: 0, errorDetails: [] as unknown[] },
      preDueReminders: { eligible: 0, sent: 0, errors: 0 },
      customerMonthly: { eligible: 0, sent: 0, errors: 0 },
      customerUpcoming: { eligible: 0, sent: 0, errors: 0 },
    },
  }

  // ── 0. Auto-flip checks past their due_date to status='overdue' ────
  // Runs every dispatcher tick (idempotent — only flips status='scheduled'
  // rows where due_date < today). Records a notification for the
  // assigned tech + each supervisor on the tenant per newly-overdue row.
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { data: stale, error: staleErr } = await supabase
      .from('maintenance_checks')
      .select('id, tenant_id, assigned_to, custom_name, due_date, sites(name), job_plans(name)')
      .eq('is_active', true)
      .eq('status', 'scheduled')
      .lt('due_date', today)
    if (staleErr) throw new Error(`scan stale: ${staleErr.message}`)

    type StaleRow = {
      id: string; tenant_id: string; assigned_to: string | null
      custom_name: string | null; due_date: string
      sites: { name: string } | { name: string }[] | null
      job_plans: { name: string } | { name: string }[] | null
    }
    const staleRows = (stale ?? []) as StaleRow[]
    const sec = summary.sections as Record<string, { flipped: number; notified: number; errors: number }>

    for (const row of staleRows) {
      const { error: updErr } = await supabase
        .from('maintenance_checks')
        .update({ status: 'overdue' })
        .eq('id', row.id)
      if (updErr) {
        sec.overdueFlip.errors++
        continue
      }
      sec.overdueFlip.flipped++

      const siteName = Array.isArray(row.sites) ? row.sites[0]?.name : row.sites?.name
      const jpName = Array.isArray(row.job_plans) ? row.job_plans[0]?.name : row.job_plans?.name
      const title = `Overdue: ${row.custom_name ?? jpName ?? 'Maintenance check'}`
      const body = [siteName, jpName, `Was due ${row.due_date}`].filter(Boolean).join(' · ')

      // Recipient set: assigned tech (if any) + active supervisors/admins on the tenant.
      const recipients = new Set<string>()
      if (row.assigned_to) recipients.add(row.assigned_to)
      const { data: ups } = await supabase
        .from('tenant_members')
        .select('user_id')
        .eq('tenant_id', row.tenant_id)
        .eq('is_active', true)
        .in('role', ['super_admin', 'admin', 'supervisor'])
      for (const r of (ups ?? []) as { user_id: string }[]) recipients.add(r.user_id)

      for (const uid of recipients) {
        // Skip if user has opted out of check_overdue.
        const { data: prefRows } = await supabase
          .rpc('get_effective_notification_prefs', { p_tenant_id: row.tenant_id, p_user_id: uid })
        const prefs = (prefRows ?? [])[0] as PrefRow | undefined
        if (prefs?.event_type_opt_outs.includes('check_overdue')) continue

        // Idempotency: don't double-notify if a row already exists for
        // this user + this check + check_overdue type.
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', uid)
          .eq('type', 'check_overdue')
          .eq('entity_id', row.id)
          .limit(1)
          .maybeSingle()
        if (existing) continue

        const { error: nErr } = await supabase.from('notifications').insert({
          tenant_id: row.tenant_id,
          user_id: uid,
          type: 'check_overdue',
          title,
          body,
          entity_type: 'maintenance_check',
          entity_id: row.id,
        })
        if (nErr) {
          sec.overdueFlip.errors++
        } else {
          sec.overdueFlip.notified++
        }
      }
    }
  } catch (err) {
    const sec = summary.sections as Record<string, { flipped: number; notified: number; errors: number }>
    sec.overdueFlip.errors++
    summary['overdueFlipError'] = (err as Error).message
  }

  // ── 1. Supervisor digest dispatch ─────────────────────────────────
  // List every active supervisor across every tenant via the helper RPC,
  // resolve their effective prefs, fire the digest if it's their slot.
  try {
    const { data: supervisors, error: supErr } = await supabase
      .rpc('list_active_supervisors')
    if (supErr) throw new Error(`list_active_supervisors: ${supErr.message}`)

    type Sup = { tenant_id: string; user_id: string; email: string; full_name: string | null; role: string }
    const supList = (supervisors ?? []) as Sup[]

    for (const sup of supList) {
      const { data: prefRows } = await supabase
        .rpc('get_effective_notification_prefs', { p_tenant_id: sup.tenant_id, p_user_id: sup.user_id })
      const prefs = (prefRows ?? [])[0] as PrefRow | undefined
      if (!prefs) continue

      const matches = forceUserId
        ? sup.user_id === forceUserId
        : isUserDigestSlot(prefs)
      if (!matches) continue

      const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number; errorDetails?: unknown[] }>
      sec.supervisorDigest.eligible++

      try {
        const results = await runSupervisorDigests({
          triggerSource: 'cron',
          horizonDays: 14,
          appUrl,
          tenantId: sup.tenant_id,
          supervisorUserId: sup.user_id,
        })
        const sentNow = results.filter(r => r.status === 'sent').length
        sec.supervisorDigest.sent += sentNow
        const errorRows = results.filter(r => r.status === 'error')
        if (errorRows.length > 0) {
          sec.supervisorDigest.errors += errorRows.length
          sec.supervisorDigest.errorDetails!.push(...errorRows.map(r => ({
            tenantId: r.tenantId, supervisorEmail: r.supervisorEmail, error: r.error,
          })))
        }
      } catch (err) {
        sec.supervisorDigest.errors++
        sec.supervisorDigest.errorDetails!.push({
          tenantId: sup.tenant_id, supervisorEmail: sup.email, error: (err as Error).message,
        })
      }
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `supervisor-digest dispatch failed: ${(err as Error).message}`, summary },
      { status: 500 },
    )
  }

  // ── 2. Pre-due reminder dispatch (Phase B) ───────────────────────────
  // Run once per "morning slot" — once per user, when their digest_time
  // hits. Same matching as digest above. We then scan for checks where
  // (due_date - today) is in their pre_due_reminder_days and create
  // bell + email per match. (Email send hooks come in next iteration.)
  try {
    const { data: assignedTechs, error: techErr } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, tenant_id')
      .eq('is_active', true)
      .in('status', ['scheduled', 'in_progress'])
      .not('assigned_to', 'is', null)
    if (techErr) throw new Error(`scan techs: ${techErr.message}`)

    // Dedupe (user_id, tenant_id) pairs so we don't process the same user
    // multiple times.
    type TechRow = { assigned_to: string | null; tenant_id: string }
    const techRows = (assignedTechs ?? []) as TechRow[]
    const uniquePairs = new Map<string, { user_id: string; tenant_id: string }>()
    for (const r of techRows) {
      if (!r.assigned_to) continue
      uniquePairs.set(`${r.tenant_id}:${r.assigned_to}`, { user_id: r.assigned_to, tenant_id: r.tenant_id })
    }

    for (const { user_id, tenant_id } of uniquePairs.values()) {
      const { data: prefRows } = await supabase
        .rpc('get_effective_notification_prefs', { p_tenant_id: tenant_id, p_user_id: user_id })
      const prefs = (prefRows ?? [])[0] as PrefRow | undefined
      if (!prefs) continue
      if (prefs.event_type_opt_outs.includes('check_due_soon')) continue

      const matches = forceUserId
        ? user_id === forceUserId
        : isUserDigestSlot(prefs)  // reminders ride the same slot
      if (!matches) continue

      const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number }>
      sec.preDueReminders.eligible++

      // For each reminder offset (e.g. 14, 7, 1), find checks due exactly
      // that many days from now, owned by this user. Create a bell row
      // for each. Email aggregation happens via the existing supervisor
      // digest path; the per-check bell is the immediate signal.
      for (const offsetDays of prefs.pre_due_reminder_days) {
        const target = new Date()
        target.setDate(target.getDate() + offsetDays)
        const dateStr = target.toISOString().slice(0, 10)
        const { data: dueChecks } = await supabase
          .from('maintenance_checks')
          .select('id, custom_name, due_date, sites(name), job_plans(name)')
          .eq('tenant_id', tenant_id)
          .eq('assigned_to', user_id)
          .eq('is_active', true)
          .eq('status', 'scheduled')
          .eq('due_date', dateStr)
        type CheckRow = {
          id: string
          custom_name: string | null
          due_date: string
          sites: { name: string } | { name: string }[] | null
          job_plans: { name: string } | { name: string }[] | null
        }
        for (const ch of (dueChecks ?? []) as CheckRow[]) {
          const siteName = Array.isArray(ch.sites) ? ch.sites[0]?.name : ch.sites?.name
          const jpName = Array.isArray(ch.job_plans) ? ch.job_plans[0]?.name : ch.job_plans?.name
          // Idempotency: skip if a notification of this type for this
          // entity was already created today (same UTC day; any user
          // timezone is fine — we just want "not duplicate today").
          const todayStart = new Date()
          todayStart.setUTCHours(0, 0, 0, 0)
          const { data: existing } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', user_id)
            .eq('type', 'check_due_soon')
            .eq('entity_id', ch.id)
            .gte('created_at', todayStart.toISOString())
            .limit(1)
            .maybeSingle()
          if (existing) continue

          const { error: insErr } = await supabase.from('notifications').insert({
            tenant_id,
            user_id,
            type: 'check_due_soon',
            title: offsetDays === 1
              ? `Due tomorrow: ${ch.custom_name ?? jpName ?? 'Maintenance check'}`
              : `Due in ${offsetDays} days: ${ch.custom_name ?? jpName ?? 'Maintenance check'}`,
            body: [siteName, jpName, `Due ${ch.due_date}`].filter(Boolean).join(' · '),
            entity_type: 'maintenance_check',
            entity_id: ch.id,
          })
          if (insErr) {
            sec.preDueReminders.errors++
          } else {
            sec.preDueReminders.sent++
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal — log into the summary, continue.
    const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number }>
    sec.preDueReminders.errors++
    summary['preDueRemindersError'] = (err as Error).message
  }

  // ── 3. Customer monthly summary (Phase C — placeholder) ──────────────
  // Skeleton for now — fires only when the customer-facing email helper
  // (lib/email/send-customer-monthly-summary.ts) is implemented in the
  // next iteration. This block scans + records eligible contacts so we
  // can verify the dispatch math before wiring the email send.
  try {
    const tzMelbourne = nowInTz('Australia/Sydney')
    const todayDom = tzMelbourne.dayOfMonth
    const { data: prefs } = await supabase
      .from('customer_notification_preferences')
      .select('id, tenant_id, customer_contact_id, monthly_summary_day, receive_monthly_summary')
      .eq('receive_monthly_summary', true)
      .eq('monthly_summary_day', todayDom)
    const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number }>
    sec.customerMonthly.eligible = (prefs ?? []).length
    // Email send wired in Phase C builder — for now we just count.
  } catch (err) {
    const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number }>
    sec.customerMonthly.errors++
    summary['customerMonthlyError'] = (err as Error).message
  }

  // ── 4. Customer upcoming-visit notice (Phase C — placeholder) ────────
  // Same skeleton — count eligible (visits 7 days out for tenants on the
  // commercial tier, customer prefs say receive_upcoming_visit), wire
  // the email send next.
  try {
    const target = new Date()
    target.setDate(target.getDate() + 7)
    const dateStr = target.toISOString().slice(0, 10)
    const { data: upcoming } = await supabase
      .from('maintenance_checks')
      .select('id, tenant_id')
      .eq('is_active', true)
      .eq('status', 'scheduled')
      .eq('due_date', dateStr)
    const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number }>
    sec.customerUpcoming.eligible = (upcoming ?? []).length
    // Per-tenant + per-customer-contact filtering wired next.
  } catch (err) {
    const sec = summary.sections as Record<string, { eligible: number; sent: number; errors: number }>
    sec.customerUpcoming.errors++
    summary['customerUpcomingError'] = (err as Error).message
  }

  if (debugFlag) {
    return NextResponse.json({ ok: true, ...summary }, { status: 200 })
  }
  return NextResponse.json({ ok: true, ...summary }, { status: 200 })
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      hint: 'POST with Authorization: Bearer $CRON_SECRET to dispatch scheduled notifications. Add ?debug=1 for verbose output, ?force_user_id=<uuid> to bypass time-matching for one user (testing only).',
    },
    { status: 405 },
  )
}
