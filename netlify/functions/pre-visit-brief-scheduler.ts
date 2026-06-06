/**
 * pre-visit-brief-scheduler.ts — Netlify Scheduled Function
 *
 * Fires daily at 07:00 UTC (~17:00 AEST / 18:00 AEDT). Posts to
 * /api/cron/pre-visit-brief with `Authorization: Bearer $CRON_SECRET` so the
 * route sends a pre-visit brief for every scheduled check happening TOMORROW
 * (in the tenant's tz) that hasn't had one yet.
 *
 * Scheduling config lives in netlify.toml under
 * `[functions."pre-visit-brief-scheduler"]`.
 *
 * SAFETY: the cron route is dry-run unless PRE_VISIT_BRIEF_CRON_ENABLED=true,
 * so this scheduler firing does NOT email real technicians until that env var
 * is set. See app/api/cron/pre-visit-brief/route.ts.
 *
 * Env vars required:
 *   CRON_SECRET          — bearer token expected by the cron route
 *   NEXT_PUBLIC_SITE_URL  (preferred) / URL — public URL of the deployed app
 *   PRE_VISIT_BRIEF_CRON_ENABLED — set to 'true' to send for real
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
    console.error('[pre-visit-brief-scheduler] CRON_SECRET not configured — aborting')
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_cron_secret' }) }
  }

  const url = `${resolveAppUrl().replace(/\/$/, '')}/api/cron/pre-visit-brief`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
    })

    const text = await res.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { /* non-JSON response */ }

    if (!res.ok) {
      console.error(`[pre-visit-brief-scheduler] endpoint returned ${res.status}: ${text}`)
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, upstream_status: res.status, upstream_body: parsed ?? text }),
      }
    }

    console.log('[pre-visit-brief-scheduler] run succeeded', parsed)
    return { statusCode: 200, body: JSON.stringify({ ok: true, upstream: parsed }) }
  } catch (err) {
    const message = (err as Error).message
    console.error('[pre-visit-brief-scheduler] fetch failed:', message)
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: message }) }
  }
}
