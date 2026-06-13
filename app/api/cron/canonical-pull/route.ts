/**
 * /api/cron/canonical-pull
 *
 * Nightly pull: fetches customers, sites, and assets from sks-canonical and
 * upserts them into eq-service's local DB. New records are created; existing
 * records (matched by canonical_id) are updated. Service-specific fields are
 * never overwritten.
 *
 * This closes the loop on the canonical sync:
 *   push direction — write-through + outbox drain (every 5 min) + reconcile (23:00 UTC)
 *   pull direction — this route, driven nightly at 22:00 UTC
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Driven by the
 * canonical-pull-scheduler Netlify Scheduled Function (netlify.toml).
 *
 * Returns { ok, ranAt, tenantId, customers, sites, assets } with created/updated/failed
 * counts per entity type.
 */

import { NextRequest, NextResponse } from 'next/server'
import { pullCanonical } from '@/lib/canonical-pull'

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

  if (!process.env.CANONICAL_API_KEY_SERVICE) {
    return NextResponse.json(
      { ok: false, error: 'CANONICAL_API_KEY_SERVICE not configured — pull skipped' },
      { status: 500 },
    )
  }

  try {
    const result = await pullCanonical()
    console.log('[canonical-pull] completed', result)
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result })
  } catch (err) {
    console.error('[canonical-pull] failed:', (err as Error).message)
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      hint: 'POST with Authorization: Bearer $CRON_SECRET to run the canonical pull. GET is read-only.',
    },
    { status: 405 },
  )
}
