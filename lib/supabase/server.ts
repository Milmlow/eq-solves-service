import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { publicEnv } from '@/lib/env'
import { shellCookieOptions } from '@/lib/auth/shell-cookies'
import type { Database } from './database.types'

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
