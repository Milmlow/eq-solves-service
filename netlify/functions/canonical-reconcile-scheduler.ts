/**
 * canonical-reconcile-scheduler.ts — Netlify Scheduled Function
 *
 * Fires daily and POSTs to /api/cron/reconcile-canonical with
 * `Authorization: Bearer $CRON_SECRET`, which re-syncs any customers/sites that
 * never reached canonical (canonical_id IS NULL) — a drift backstop for the
 * outbox so the reference layer self-heals.
 *
 * Scheduling config lives in netlify.toml under
 * `[functions."canonical-reconcile-scheduler"]`.
 *
 * Env vars required:
 *   CRON_SECRET          — bearer token expected by /api/cron/reconcile-canonical
 *   NEXT_PUBLIC_SITE_URL (preferred) / URL — public URL of the deployed app
 *
 * Failures are logged but don't throw — the next run retries.
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
    console.error('[reconcile-scheduler] CRON_SECRET not configured — aborting')
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_cron_secret' }) }
  }

  const url = `${resolveAppUrl().replace(/\/$/, '')}/api/cron/reconcile-canonical`

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
      console.error(`[reconcile-scheduler] reconcile endpoint returned ${res.status}: ${text}`)
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, upstream_status: res.status, upstream_body: parsed ?? text }),
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, upstream: parsed }) }
  } catch (err) {
    const message = (err as Error).message
    console.error('[reconcile-scheduler] fetch failed:', message)
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: message }) }
  }
}
