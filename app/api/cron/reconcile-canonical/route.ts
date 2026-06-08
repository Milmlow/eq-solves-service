/**
 * /api/cron/reconcile-canonical
 *
 * Drift backstop for the canonical reference layer: re-syncs customers/sites that
 * were never confirmed in canonical (canonical_id IS NULL) through the durable
 * path (sync failures land in the outbox). Catches pre-outbox rows and missed
 * enqueues, so the reference layer self-heals. See lib/canonical-reconcile.ts.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Driven daily by the
 * canonical-reconcile-scheduler Netlify Scheduled Function (see netlify.toml).
 *
 * Optional ?limit=<1..1000> bounds each entity batch (default 200).
 * Returns { ok, ranAt, customers: {scanned, synced}, sites: {scanned, synced} }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { reconcileCanonical } from '@/lib/canonical-reconcile'

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
    ? Math.min(1000, Math.max(1, parseInt(limitParam, 10) || 200))
    : 200

  try {
    const result = await reconcileCanonical(limit)
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}

// GET returns a hint for humans hitting the URL in a browser; never reconciles.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      hint: 'POST with Authorization: Bearer $CRON_SECRET to reconcile canonical. GET is read-only.',
    },
    { status: 405 },
  )
}
