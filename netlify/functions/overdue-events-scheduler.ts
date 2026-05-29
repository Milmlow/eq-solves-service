/**
 * overdue-events-scheduler.ts — Netlify Scheduled Function
 *
 * Fires daily at 22:00 UTC (08:00 AEST / 09:00 AEDT). POSTs to
 * /api/cron/overdue-events with Authorization: Bearer $CRON_SECRET
 * so the route queries for overdue defects and maintenance checks and
 * emits canonical events for each one.
 *
 * Scheduling config lives in netlify.toml under
 * `[functions."overdue-events-scheduler"]`.
 *
 * Env vars required:
 *   CRON_SECRET             — bearer token expected by /api/cron/overdue-events
 *   NEXT_PUBLIC_SITE_URL    — canonical URL of the deployed app
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

function resolveAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.URL ||
    'https://eq-solves-service.netlify.app'
  )
}

export const handler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[overdue-events-scheduler] CRON_SECRET not configured — aborting')
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_cron_secret' }) }
  }

  const url = `${resolveAppUrl()}/api/cron/overdue-events`
  console.log('[overdue-events-scheduler] POST', url)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type':  'application/json',
      },
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[overdue-events-scheduler] route returned', res.status, body)
      return { statusCode: res.status, body: JSON.stringify(body) }
    }

    console.log('[overdue-events-scheduler] done:', body)
    return { statusCode: 200, body: JSON.stringify(body) }
  } catch (e) {
    console.error('[overdue-events-scheduler] fetch failed:', (e as Error).message)
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: (e as Error).message }) }
  }
}
