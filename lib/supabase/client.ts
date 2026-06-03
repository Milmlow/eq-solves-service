import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import { shellCookieOptions } from '@/lib/auth/shell-cookies'
import type { Database } from './database.types'

export function createClient() {
  // SameSite policy depends on the deploy host (see lib/auth/shell-cookies):
  // Lax under *.eq.solutions (same-site iframe with Shell — the Cards/Field
  // pattern, survives Safari/Chrome third-party-cookie blocking), None as a
  // cutover fallback while still on *.netlify.app.
  const cookieOptions = shellCookieOptions(
    typeof window !== 'undefined' ? window.location.hostname : null
  )

  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Object.keys(cookieOptions).length > 0 ? { cookieOptions } : {}
  )
}
