/**
 * GET /api/site-credentials/[id]/decrypt
 *
 * Returns the decrypted username + password for a single site credential.
 * Supervisor+ only. The key is injected server-side from SITE_CREDENTIALS_KEY
 * (Netlify env) — it is never exposed to the client or logged.
 *
 * Response shape:
 *   { data: { id, system_name, url, notes, username, password } }
 *
 * Rate limiting: enforced at the Netlify edge (see netlify.toml [functions.site-creds]).
 * Audit: every decrypt call logs to Sentry as a breadcrumb (no plaintext in the log).
 */

import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/api/auth'
import { ok, err, unauthorized, forbidden } from '@/lib/api/response'

const SUPERVISOR_ROLES = ['super_admin', 'admin', 'supervisor'] as const

function getCredentialsKey(): string | null {
  return process.env.SITE_CREDENTIALS_KEY ?? null
}

export async function GET(
  _request: NextRequest,
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
      console.error('[site-credentials decrypt] SITE_CREDENTIALS_KEY not set')
      return err('Encryption key not configured — contact your administrator.', 503)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('decrypt_site_credential', {
      p_credential_id: id,
      p_key: credKey,
    })

    if (error) {
      // Distinguish auth errors from server errors
      if (error.message.includes('insufficient role') || error.message.includes('not found')) {
        return forbidden()
      }
      console.error('[site-credentials decrypt] RPC error:', error.message)
      return err(error.message, 500)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = data as any[]
    if (!rows || rows.length === 0) return err('Credential not found.', 404)

    const row = rows[0]

    // Audit log — no plaintext in the message
    console.info(
      `[site-credentials decrypt] tenant=${tenantId} credential=${id} user=${user.id} role=${role}`
    )

    return ok({
      id:          row.id,
      system_name: row.system_name,
      url:         row.url,
      notes:       row.notes,
      username:    row.username_dec,
      password:    row.password_dec,
    })
  } catch (e) {
    console.error('[site-credentials decrypt]', e)
    return err('Internal server error.', 500)
  }
}
