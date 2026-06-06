/**
 * /api/cron/pre-visit-brief
 *
 * Phase 2 of the pre-visit tech brief. Fires once daily (Netlify scheduled
 * function, ~17:00 AEST). For every active tenant, finds scheduled checks whose
 * visit is TOMORROW in the tenant's local timezone, that have an assigned
 * technician and have not had a brief sent yet, respects the per-tech opt-out,
 * and sends the brief.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (mirrors supervisor-digest).
 *
 * SAFETY — dry-run by default. The cron only sends for real when
 * PRE_VISIT_BRIEF_CRON_ENABLED === 'true'. Until then it composes/validates and
 * reports what it WOULD send, sending nothing. Flip the env var in Netlify to
 * go live. This prevents the cron from emailing real technicians before it has
 * been verified end-to-end.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { composeAndSendPreVisitBrief } from '@/lib/notifications/send-pre-visit-brief'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Local calendar date (YYYY-MM-DD) for an instant in a given IANA timezone. */
function dateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

interface PrefRow {
  event_type_opt_outs: string[]
  email_enabled: boolean
  timezone: string
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured on server' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const enabled = process.env.PRE_VISIT_BRIEF_CRON_ENABLED === 'true'
  const dryRun = !enabled

  const supabase = createAdminClient()

  // "Tomorrow" anchor — 24h from now, resolved per-tenant in their tz below.
  const tomorrowInstant = new Date(Date.now() + 24 * 60 * 60 * 1000)

  let total = 0
  let sent = 0
  let dryRunWould = 0
  let skippedOptOut = 0
  let skippedNotSendable = 0
  let errored = 0
  const errors: { checkId: string; error: string }[] = []

  try {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id')
      .eq('is_active', true)

    for (const tenant of tenants ?? []) {
      const tenantId = tenant.id as string

      // Tenant default timezone (notification_preferences tenant-default row).
      const { data: tzRow } = await supabase
        .from('notification_preferences')
        .select('timezone')
        .eq('tenant_id', tenantId)
        .is('user_id', null)
        .maybeSingle()
      const tz = (tzRow as { timezone?: string | null } | null)?.timezone || 'Australia/Sydney'
      const tomorrowStr = dateInTz(tomorrowInstant, tz)

      // Candidate checks: scheduled, active, assigned. The "brief not yet sent"
      // and exact tz-date match are filtered in JS below — pre_visit_brief_sent_at
      // is selected in the string but isn't in the generated types yet
      // (migration 0121), so we avoid a typed .is() filter on it.
      const { data: candidates } = await supabase
        .from('maintenance_checks')
        .select('id, assigned_to, due_date, scheduled_start_at, pre_visit_brief_sent_at, status, is_active')
        .eq('tenant_id', tenantId)
        .eq('status', 'scheduled')
        .eq('is_active', true)
        .not('assigned_to', 'is', null)

      for (const c of candidates ?? []) {
        const check = c as {
          id: string
          assigned_to: string | null
          due_date: string | null
          scheduled_start_at: string | null
          pre_visit_brief_sent_at: string | null
        }
        if (check.pre_visit_brief_sent_at) continue
        const visitDate = check.scheduled_start_at
          ? dateInTz(new Date(check.scheduled_start_at), tz)
          : check.due_date
        if (visitDate !== tomorrowStr) continue

        total++

        // Per-tech opt-out (default ON — tech must opt out).
        const { data: prefRows } = await supabase.rpc('get_effective_notification_prefs', {
          p_tenant_id: tenantId,
          p_user_id: check.assigned_to as string,
        })
        const prefs = (prefRows ?? [])[0] as PrefRow | undefined
        if (prefs?.event_type_opt_outs?.includes('pre_visit_tech_brief')) {
          skippedOptOut++
          continue
        }

        try {
          const result = await composeAndSendPreVisitBrief(supabase, check.id, tenantId, {
            dryRun,
            markSent: !dryRun,
          })
          if (!result.success) {
            skippedNotSendable++
          } else if (dryRun) {
            dryRunWould++
          } else {
            sent++
          }
        } catch (err) {
          errored++
          errors.push({ checkId: check.id, error: (err as Error).message })
        }
      }
    }

    return NextResponse.json({
      ok: true,
      mode: dryRun ? 'dry_run' : 'live',
      generatedAt: new Date().toISOString(),
      total,
      sent,
      dryRunWould,
      skippedOptOut,
      skippedNotSendable,
      errored,
      errors: errors.slice(0, 25),
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

// GET — human hint; never sends.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      hint: 'POST with Authorization: Bearer $CRON_SECRET to run the pre-visit brief cron. Dry-run unless PRE_VISIT_BRIEF_CRON_ENABLED=true.',
    },
    { status: 405 },
  )
}
