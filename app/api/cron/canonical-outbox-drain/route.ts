/**
 * /api/cron/canonical-outbox-drain
 *
 * Drains public.canonical_outbox: replays pending canonical-api writes that
 * failed their inline attempt, with exponential backoff, until delivered or
 * exhausted (dead). This is the durability half of the canonical write path —
 * see lib/canonical-outbox.ts and lib/canonical-sync.ts.
 *
 * Auth: must include `Authorization: Bearer ${CRON_SECRET}` (same pattern as
 * /api/cron/supervisor-digest). Driven by the canonical-outbox-scheduler Netlify
 * Scheduled Function (every 5 minutes; see netlify.toml). Can also be triggered
 * by pg_cron + http or an external cron.
 *
 * Returns 200 with a JSON run summary { processed, delivered, retried, dead }.
 * Optional ?limit=<1..200> bounds the batch (default 50).
 */

import { NextRequest, NextResponse } from 'next/server'
import { drainCanonicalOutbox } from '@/lib/canonical-outbox'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam
    ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50))
    : 50

  try {
    const summary = await drainCanonicalOutbox(limit)
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...summary })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}

// GET returns a hint for humans hitting the URL in a browser; never drains.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      hint: 'POST with Authorization: Bearer $CRON_SECRET to drain the canonical outbox. GET is read-only.',
    },
    { status: 405 },
  )
}
