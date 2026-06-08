/**
 * canonical-outbox.ts — durable delivery for the canonical-api write path.
 *
 * The canonical reference layer (sks-canonical) is reached over HTTP via
 * canonical-sync.ts. That call used to be fire-and-forget: a network / 5xx /
 * non-JSON failure was logged and the write was lost, with nothing to reconcile
 * it later. This module makes the write path durable:
 *
 *   enqueueCanonicalOutbox()  — called by canonical-sync.ts when an inline
 *     PUT/POST fails *transiently*. Persists the exact body in
 *     public.canonical_outbox so it is never silently dropped.
 *
 *   drainCanonicalOutbox()    — called by /api/cron/canonical-outbox-drain.
 *     Replays due pending rows to canonical-api with exponential backoff. On a
 *     successful PUT it writes canonical_id back to the source customers/sites
 *     row. The hub upserts idempotently on (tenant_id, external_id), so a replay
 *     is safe even if the original inline attempt actually landed.
 *
 * Service-role only: all DB access uses the admin client (bypasses RLS), matching
 * the RLS-on/no-policy posture of public.canonical_outbox.
 */

import { createAdminClient } from '@/lib/supabase/admin'

const API_URL = process.env.CANONICAL_API_URL ?? 'https://core.eq.solutions'
const API_KEY = process.env.CANONICAL_API_KEY_SERVICE
const TENANT  = process.env.CANONICAL_TENANT_SLUG ?? 'sks'

const CANONICAL_ENDPOINT = `${API_URL.replace(/\/$/, '')}/.netlify/functions/canonical-api`

const DEFAULT_BATCH = 50
const BACKOFF_BASE_SECONDS = 60;          // 1m, 2m, 4m, ...
const BACKOFF_CAP_SECONDS  = 6 * 60 * 60; // capped at 6h

export type OutboxMethod = 'PUT' | 'POST'

export interface EnqueueInput {
  method:      OutboxMethod
  resource:    string
  body:        Record<string, unknown>   // exact body to send to canonical-api
  externalId?: string | null             // PUT upsert key + write-back source
  event?:      string | null             // POST event name
  dedupeKey?:  string | null             // entity PUTs set '<resource>:<external_id>'; events leave null
}

export interface DrainResult {
  processed: number
  delivered: number
  retried:   number
  dead:      number
}

interface OutboxRow {
  id:           string
  method:       OutboxMethod
  resource:     string
  external_id:  string | null
  body:         Record<string, unknown>
  attempts:     number
  max_attempts: number
}

interface CanonicalApiResponse {
  ok:            boolean
  canonical_id?: string
  error?:        string
  detail?:       string
}

/**
 * A failure worth retrying: server-side / transient. Permanent 4xx (bad request,
 * auth, forbidden, not-found) will never succeed on replay, so they are NOT
 * enqueued (and are marked dead immediately if hit during a drain).
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}

function backoffSeconds(attempts: number): number {
  const secs = BACKOFF_BASE_SECONDS * Math.pow(2, Math.min(attempts, 12))
  return Math.min(secs, BACKOFF_CAP_SECONDS)
}

/**
 * Persist a failed (or deferred) canonical-api write to the outbox. Never throws
 * — enqueue failures are logged; the caller already has its local write.
 */
export async function enqueueCanonicalOutbox(input: EnqueueInput): Promise<void> {
  try {
    const admin = createAdminClient()
    const nowIso = new Date().toISOString()
    const row = {
      method:          input.method,
      resource:        input.resource,
      external_id:     input.externalId ?? null,
      event:           input.event ?? null,
      body:            input.body,
      dedupe_key:      input.dedupeKey ?? null,
      status:          'pending',
      attempts:        0,
      next_attempt_at: nowIso,
      last_status:     null,
      last_error:      null,
      canonical_id:    null,
      delivered_at:    null,
      updated_at:      nowIso,
    }

    // Entity PUTs de-dupe on (resource, external_id): repeated failed syncs of
    // the same record collapse to one pending row carrying the latest body, and
    // a previously delivered/dead row is reset to pending if the record changes
    // again. Events have no dedupe_key (each distinct) so they plain-insert.
    if (input.dedupeKey) {
      const { error } = await (admin as unknown as SupabaseLike)
        .from('canonical_outbox')
        .upsert(row, { onConflict: 'dedupe_key' })
      if (error) throw new Error(error.message)
    } else {
      const { error } = await (admin as unknown as SupabaseLike)
        .from('canonical_outbox')
        .insert(row)
      if (error) throw new Error(error.message)
    }
  } catch (e) {
    console.error('[canonical-outbox] enqueue failed', {
      resource: input.resource, externalId: input.externalId, event: input.event,
      error: (e as Error).message,
    })
  }
}

/**
 * Replay due pending outbox rows to canonical-api. Returns a per-run summary.
 * Safe to call repeatedly (idempotent hub + per-row state machine).
 */
export async function drainCanonicalOutbox(limit = DEFAULT_BATCH): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, delivered: 0, retried: 0, dead: 0 }

  if (!API_KEY) {
    console.warn('[canonical-outbox] CANONICAL_API_KEY_SERVICE not set — drain skipped')
    return result
  }

  const admin = createAdminClient()
  const sb = admin as unknown as SupabaseLike

  const { data: rows, error } = await sb
    .from('canonical_outbox')
    .select('id, method, resource, external_id, body, attempts, max_attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`outbox select failed: ${error.message}`)
  }
  const pending = (rows ?? []) as OutboxRow[]
  if (pending.length === 0) return result

  for (const row of pending) {
    result.processed++

    let res: Response | null = null
    let parsed: CanonicalApiResponse | null = null
    let networkError: string | null = null

    try {
      res = await fetch(CANONICAL_ENDPOINT, {
        method:  row.method,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'X-Tenant':      TENANT,
        },
        body: JSON.stringify(row.body),
      })
      try { parsed = await res.json() as CanonicalApiResponse } catch { parsed = null }
    } catch (e) {
      networkError = (e as Error).message
    }

    const delivered = !!res && res.ok && !!parsed && parsed.ok === true

    if (delivered) {
      const canonicalId = parsed?.canonical_id ?? null
      await sb
        .from('canonical_outbox')
        .update({
          status:       'delivered',
          delivered_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
          last_status:  res?.status ?? null,
          last_error:   null,
          canonical_id: canonicalId,
        })
        .eq('id', row.id)

      if (canonicalId && row.method === 'PUT') {
        await writeBackCanonicalId(sb, row.resource, row.external_id, canonicalId)
      }
      result.delivered++
      continue
    }

    // Failure. Permanent 4xx will never succeed on replay → dead immediately.
    const httpStatus = res?.status
    const permanent = typeof httpStatus === 'number'
      && httpStatus >= 400 && httpStatus < 500
      && !isRetryableHttpStatus(httpStatus)

    const attempts = row.attempts + 1
    const dead = permanent || attempts >= row.max_attempts
    const errMsg = (networkError ?? parsed?.error ?? (res ? `http_${res.status}` : 'no_response')).slice(0, 500)

    await sb
      .from('canonical_outbox')
      .update({
        status:          dead ? 'dead' : 'pending',
        attempts,
        next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString(),
        last_status:     res?.status ?? null,
        last_error:      errMsg,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', row.id)

    if (dead) {
      result.dead++
      console.error('[canonical-outbox] row marked dead', {
        id: row.id, resource: row.resource, external_id: row.external_id,
        attempts, permanent, lastError: errMsg,
      })
    } else {
      result.retried++
    }
  }

  return result
}

/**
 * After a successful PUT, write the canonical_id back to the EQ Service source
 * row so the local cache knows its canonical identity. Best-effort: the
 * canonical record already exists; never fail the drain over the back-link.
 *
 * Only customers and sites carry a canonical_id column. The source id is parsed
 * from the eq-service external_id convention (see canonical-sync.ts helpers).
 */
async function writeBackCanonicalId(
  sb: SupabaseLike,
  resource: string,
  externalId: string | null,
  canonicalId: string,
): Promise<void> {
  if (!externalId) return

  let table: 'customers' | 'sites' | null = null
  let sourceId: string | null = null
  if (resource === 'customers' && externalId.startsWith('eq-service:')) {
    table = 'customers'
    sourceId = externalId.slice('eq-service:'.length)
  } else if (resource === 'sites' && externalId.startsWith('eq-service:site:')) {
    table = 'sites'
    sourceId = externalId.slice('eq-service:site:'.length)
  }
  if (!table || !sourceId) return  // assets/tests/defects: no canonical_id back-link

  try {
    await sb
      .from(table)
      .update({ canonical_id: canonicalId, canonical_synced_at: new Date().toISOString() })
      .eq('id', sourceId)
  } catch (e) {
    console.warn('[canonical-outbox] canonical_id write-back failed', {
      table, sourceId, error: (e as Error).message,
    })
  }
}

// Minimal structural type for the bits of the supabase-js builder we use. The
// generated Database type does not yet include canonical_outbox; rather than
// block on regenerating types we access these tables through this shape. (Run
// `supabase gen types` after applying 0099 to restore full typing.)
interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        lte(col: string, val: unknown): {
          order(col: string, opts: { ascending: boolean }): {
            limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>
          }
        }
      }
    }
    insert(row: unknown): Promise<{ error: { message: string } | null }>
    upsert(row: unknown, opts: { onConflict: string }): Promise<{ error: { message: string } | null }>
    update(row: unknown): {
      eq(col: string, val: unknown): Promise<{ error: { message: string } | null }>
    }
  }
}
