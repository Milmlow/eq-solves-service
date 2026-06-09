/**
 * /api/site-credentials/[id]
 *
 * PATCH  — update an existing credential (supervisor+).
 *          Re-encrypts username + password via upsert_site_credential() RPC.
 *
 * DELETE — soft-delete (sets is_active=false) — admin+ only.
 *
 * GET /api/site-credentials/[id]/decrypt is the separate decryption endpoint
 * (see [id]/decrypt/route.ts).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getApiUser } from '@/lib/api/auth'
import { ok, err, unauthorized, forbidden } from '@/lib/api/response'

const SUPERVISOR_ROLES = ['super_admin', 'admin', 'supervisor'] as const
const ADMIN_ROLES      = ['super_admin', 'admin'] as const

const UpdateCredentialSchema = z.object({
  system_name: z.string().min(1).max(200).optional(),
  username:    z.string().max(500).optional().nullable(),
  password:    z.string().max(2000).optional().nullable(),
  url:         z.string().url().optional().nullable(),
  notes:       z.string().max(5000).optional().nullable(),
})

function getCredentialsKey(): string | null {
  return process.env.SITE_CREDENTIALS_KEY ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!SUPERVISOR_ROLES.includes(role as typeof SUPERVISOR_ROLES[number])) {
      return forbidden()
    }

    const credKey = getCredentialsKey()
    if (!credKey) {
      console.error('[site-credentials PATCH] SITE_CREDENTIALS_KEY not set')
      return err('Encryption key not configured — contact your administrator.', 503)
    }

    // Fetch current values so we can merge (only re-encrypt what changed)
    const { data: current, error: fetchErr } = await supabase
      .from('site_credentials')
      .select('tenant_id, customer_id, site_id, system_name, url, notes')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchErr || !current) return err('Credential not found.', 404)

    const body = await request.json()
    const parsed = UpdateCredentialSchema.safeParse(body)
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(', '), 422)
    }

    const { system_name, username, password, url, notes } = parsed.data

    // Decrypt existing values so we can merge (username/password may not be in the patch)
    let existingUsername = ''
    let existingPassword = ''

    if (username === undefined || password === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dec, error: decErr } = await (supabase as any).rpc('decrypt_site_credential', {
        p_credential_id: id,
        p_key: credKey,
      })
      if (decErr) {
        console.error('[site-credentials PATCH] decrypt error:', decErr.message)
        return err('Failed to read existing credential for update.', 500)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decRows = dec as any[]
      if (decRows && decRows.length > 0) {
        existingUsername = decRows[0].username_dec ?? ''
        existingPassword = decRows[0].password_dec ?? ''
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: credId, error: rpcErr } = await (supabase as any).rpc('upsert_site_credential', {
      p_tenant_id:   current.tenant_id,
      p_customer_id: current.customer_id,
      p_site_id:     current.site_id,
      p_system_name: system_name ?? current.system_name,
      p_username:    username !== undefined ? (username ?? '') : existingUsername,
      p_password:    password !== undefined ? (password ?? '') : existingPassword,
      p_url:         url !== undefined ? url : current.url,
      p_notes:       notes !== undefined ? notes : current.notes,
      p_key:         credKey,
      p_id:          id,
    })

    if (rpcErr) {
      console.error('[site-credentials PATCH] RPC error:', rpcErr.message)
      return err(rpcErr.message, 500)
    }

    return ok({ id: credId })
  } catch (e) {
    console.error('[site-credentials PATCH]', e)
    return err('Internal server error.', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!ADMIN_ROLES.includes(role as typeof ADMIN_ROLES[number])) {
      return forbidden()
    }

    const { error } = await supabase
      .from('site_credentials')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return err(error.message, 500)

    return ok({ id })
  } catch (e) {
    console.error('[site-credentials DELETE]', e)
    return err('Internal server error.', 500)
  }
}
