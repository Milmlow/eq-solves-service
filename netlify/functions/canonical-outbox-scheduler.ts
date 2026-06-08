/**
 * canonical-outbox-scheduler.ts — Netlify Scheduled Function
 *
 * Fires every 5 minutes and POSTs to /api/cron/canonical-outbox-drain with
 * `Authorization: Bearer $CRON_SECRET`, so the route replays any canonical-api
 * writes that failed their inline attempt (durability for the canonical write
 * path — see lib/canonical-outbox.ts).
 *
 * Scheduling config lives in netlify.toml under
 * `[functions."canonical-outbox-scheduler"]`.
 *
 * Env vars required:
 *   CRON_SECRET          — bearer token expected by /api/cron/canonical-outbox-drain
 *   NEXT_PUBLIC_SITE_URL (preferred) / URL — public URL of the deployed app
 *
 * Failures are logged but don't throw. The outbox rows stay 'pending' and are
 * retried on the next tick, so a missed run is self-healing.
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

function resolveAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.URL ||
    'https://service.eq.solutions'
  )
}

export const handler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[outbox-scheduler] CRON_SECRET not configured — aborting')
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_cron_secret' }) }
  }

  const url = `${resolveAppUrl().replace(/\/$/, '')}/api/cron/canonical-outbox-drain`

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
      console.error(`[outbox-scheduler] drain endpoint returned ${res.status}: ${text}`)
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, upstream_status: res.status, upstream_body: parsed ?? text }),
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, upstream: parsed }) }
  } catch (err) {
    const message = (err as Error).message
    console.error('[outbox-scheduler] fetch failed:', message)
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: message }) }
  }
}
