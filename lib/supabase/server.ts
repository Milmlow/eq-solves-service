import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { publicEnv } from '@/lib/env'
import { shellCookieOptions } from '@/lib/auth/shell-cookies'
import type { Database } from './database.types'

/**
 * Creates a Supabase client authenticated with an explicit JWT Bearer token.
 * Used by the Shell JWT path (Plan B) so that RLS policies using auth.jwt()
 * evaluate correctly — the eq_service_jwt contains tenant_id and eq_role in
 * app_metadata, which RLS reads via auth.jwt() -> 'app_metadata' ->> 'tenant_id'.
 */
export function createJwtClient(jwt: string) {
  // Identity convergence (Phase 1, gated): when IDENTITY_CLAIMS_ENABLED, the
  // data-JWT is signed with Service's OWN (urjh) secret and Service's data lives
  // in urjh, so target Service's own project — the JWT is validated natively and
  // RLS resolves identity from its claims (migration 0131). When OFF (default),
  // legacy routing: the JWT path queried ehow (sks-canonical) app_data.* via
  // CANONICAL_SUPABASE_URL, falling back to the main URL for local dev.
  const useOwnProject = process.env.IDENTITY_CLAIMS_ENABLED === 'true'
  const url = useOwnProject
    ? publicEnv.NEXT_PUBLIC_SUPABASE_URL
    : (process.env.CANONICAL_SUPABASE_URL ?? publicEnv.NEXT_PUBLIC_SUPABASE_URL)
  const key = useOwnProject
    ? publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : (process.env.CANONICAL_SUPABASE_ANON_KEY ?? publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  return createServerClient<Database>(
    url,
    key,
    {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      cookies: { getAll: () => [], setAll: () => {} },
    }
  )
}

export async function createClient() {
  const cookieStore = await cookies()
  // SameSite policy depends on the deploy host (see lib/auth/shell-cookies):
  // Lax under *.eq.solutions (same-site iframe), None fallback on *.netlify.app.
  const host = (await headers()).get('host')
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            const sameSiteOverride = shellCookieOptions(host)
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...sameSiteOverride })
            )
          } catch {}
        },
      },
    }
  )
}
