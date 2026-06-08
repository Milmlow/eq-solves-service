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
  // JWT path queries ehow (sks-canonical) app_data.* via CANONICAL_SUPABASE_URL.
  // Falls back to the main URL so local dev without canonical env vars still boots.
  const canonicalUrl = process.env.CANONICAL_SUPABASE_URL ?? publicEnv.NEXT_PUBLIC_SUPABASE_URL
  const canonicalKey = process.env.CANONICAL_SUPABASE_ANON_KEY ?? publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return createServerClient<Database>(
    canonicalUrl,
    canonicalKey,
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
