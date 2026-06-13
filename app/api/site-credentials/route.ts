/**
 * /api/site-credentials
 *
 * POST — create a new site credential (supervisor+).
 *        Encrypts username + password via upsert_site_credential() RPC;
 *        the SITE_CREDENTIALS_KEY env var is passed to Postgres at call
 *        time and is NEVER stored in the database.
 *
 * GET  — list credentials for a customer/site (metadata only, no plaintext).
 *        Returns system_name, url, notes, site_id — never decrypted values.
 *        Use GET /api/site-credentials/[id]/decrypt for a single decrypted row.
 *
 * Security notes:
 *   - SITE_CREDENTIALS_KEY must be set in Netlify env (never committed).
 *   - The Supabase RPC is SECURITY DEFINER and re-checks role server-side.
 *   - This route runs in the Next.js Edge runtime so the key is available
 *     via process.env without a cold-start DB lookup.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getApiUser, canWrite } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'

const CreateCredentialSchema = z.object({
  customer_id:  z.string().uuid(),
  site_id:      z.string().uuid().nullable().optional(),
  system_name:  z.string().min(1).max(200),
  username:     z.string().max(500).optional().nullable(),
  password:     z.string().max(2000).optional().nullable(),
  url:          z.string().url().optional().nullable(),
  notes:        z.string().max(5000).optional().nullable(),
})

function getCredentialsKey(): string | null {
  return process.env.SITE_CREDENTIALS_KEY ?? null
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!canWrite(role)) {
      return forbidden()
    }

    const params = request.nextUrl.searchParams
    const customerId = params.get('customer_id')
    const siteId     = params.get('site_id')
    const { page, per_page, from, to } = parsePagination(params)

    let query = supabase
      .from('site_credentials')
      .select(
        'id, system_name, url, notes, site_id, customer_id, is_active, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('system_name', { ascending: true })
      .range(from, to)

    if (customerId) query = query.eq('customer_id', customerId)
    if (siteId)     query = query.eq('site_id', siteId)

    const { data, count, error } = await query
    if (error) return err(error.message, 500)

    return ok(data, paginationMeta(page, per_page, count ?? 0))
  } catch (e) {
    console.error('[site-credentials GET]', e)
    return err('Internal server error.', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!canWrite(role)) {
      return forbidden()
    }

    const credKey = getCredentialsKey()
    if (!credKey) {
      console.error('[site-credentials POST] SITE_CREDENTIALS_KEY not set')
      return err('Encryption key not configured — contact your administrator.', 503)
    }

    const body = await request.json()
    const parsed = CreateCredentialSchema.safeParse(body)
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(', '), 422)
    }

    const { customer_id, site_id, system_name, username, password, url, notes } = parsed.data

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: credId, error: rpcErr } = await (supabase as any).rpc('upsert_site_credential', {
      p_tenant_id:   tenantId,
      p_customer_id: customer_id,
      p_site_id:     site_id ?? null,
      p_system_name: system_name,
      p_username:    username ?? '',
      p_password:    password ?? '',
      p_url:         url ?? null,
      p_notes:       notes ?? null,
      p_key:         credKey,
      p_id:          null,
    })

    if (rpcErr) {
      console.error('[site-credentials POST] RPC error:', rpcErr.message)
      return err(rpcErr.message, 500)
    }

    return created({ id: credId })
  } catch (e) {
    console.error('[site-credentials POST]', e)
    return err('Internal server error.', 500)
  }
}
