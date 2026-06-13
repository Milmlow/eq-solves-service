/**
 * canonical-pull-scheduler.ts — Netlify Scheduled Function
 *
 * Fires nightly at 22:00 UTC and POSTs to /api/cron/canonical-pull with
 * `Authorization: Bearer $CRON_SECRET`. Pulls customers, sites, and assets
 * from sks-canonical into eq-service — the reverse of the write-through sync.
 *
 * This closes the loop: changes made in EQ Field (new assets, renamed sites,
 * new customers) flow into sks-canonical automatically; this cron propagates
 * those changes into eq-service each night so the CMMS stays current.
 *
 * Runs at 22:00 UTC (before the reconcile backstop at 23:00 UTC), so any
 * newly-pulled records are immediately picked up by the reconcile run if
 * their write-through stamp was missed.
 *
 * Scheduling config lives in netlify.toml under
 * `[functions."canonical-pull-scheduler"]`.
 *
 * Env vars required:
 *   CRON_SECRET                — bearer token expected by /api/cron/canonical-pull
 *   CANONICAL_API_KEY_SERVICE  — bearer token for the canonical API
 *   NEXT_PUBLIC_SITE_URL / URL — public URL of the deployed app
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
    console.error('[canonical-pull-scheduler] CRON_SECRET not configured — aborting')
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_cron_secret' }) }
  }

  if (!process.env.CANONICAL_API_KEY_SERVICE) {
    console.warn('[canonical-pull-scheduler] CANONICAL_API_KEY_SERVICE not set — pull skipped')
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'no_canonical_key' }) }
  }

  const url = `${resolveAppUrl().replace(/\/$/, '')}/api/cron/canonical-pull`

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
    try { parsed = JSON.parse(text) } catch { /* non-JSON */ }

    if (!res.ok) {
      console.error(`[canonical-pull-scheduler] pull endpoint returned ${res.status}: ${text}`)
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, upstream_status: res.status, upstream_body: parsed ?? text }),
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, upstream: parsed }) }
  } catch (err) {
    const message = (err as Error).message
    console.error('[canonical-pull-scheduler] fetch failed:', message)
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: message }) }
  }
}
