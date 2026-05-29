/**
 * /api/cron/overdue-events
 *
 * Queries for open defects older than 24h and maintenance checks
 * with status='overdue', then emits canonical events for each.
 * Called daily by overdue-events-scheduler.ts (Netlify Scheduled Function).
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Returns 200 with { ok: true, defects_emitted, checks_emitted }
 * Errors per item don't fail the request — item-level failures are logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'
import { emitEvent }                 from '@/lib/canonical-sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase        = getServiceClient()
  const cutoff24h       = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  let defects_emitted   = 0
  let checks_emitted    = 0

  // ── Overdue defects (open/in_progress, older than 24h) ───────────────────
  try {
    const { data: defects, error } = await supabase
      .from('defects')
      .select('id, title, severity, site_id, created_at')
      .in('status', ['open', 'in_progress'])
      .lt('created_at', cutoff24h)
      .limit(50)

    if (error) {
      console.error('[overdue-events] defects query failed:', error.message)
    } else {
      for (const d of defects ?? []) {
        const hoursOpen = Math.round(
          (Date.now() - new Date(d.created_at).getTime()) / 3_600_000
        )
        void emitEvent('defect.overdue', {
          reference:  `DEF-${d.id.slice(0, 8).toUpperCase()}`,
          title:      d.title,
          severity:   d.severity,
          site_id:    d.site_id ?? undefined,
          hours_open: hoursOpen,
        })
        defects_emitted++
      }
    }
  } catch (e) {
    console.error('[overdue-events] defects section failed:', (e as Error).message)
  }

  // ── Overdue maintenance checks ────────────────────────────────────────────
  try {
    const { data: checks, error } = await supabase
      .from('maintenance_checks')
      .select('id, due_date, assigned_to')
      .eq('status', 'overdue')
      .limit(50)

    if (error) {
      console.error('[overdue-events] checks query failed:', error.message)
    } else {
      for (const c of checks ?? []) {
        void emitEvent('maintenance_check.overdue', {
          check_id:    c.id,
          due_date:    c.due_date,
          assigned_to: c.assigned_to ?? undefined,
        })
        checks_emitted++
      }
    }
  } catch (e) {
    console.error('[overdue-events] checks section failed:', (e as Error).message)
  }

  console.log(`[overdue-events] done: defects=${defects_emitted} checks=${checks_emitted}`)
  return NextResponse.json({ ok: true, defects_emitted, checks_emitted })
}
