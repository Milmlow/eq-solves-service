import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from './database.types'

export function createClient() {
  // SameSite=None required in production: Service is embedded cross-site inside
  // Shell (core.eq.solutions ≠ eq-solves-service.netlify.app). Lax cookies set
  // by verifyOtp / signIn are not sent in cross-site sub-frame navigation
  // requests, so the server-side session would be invisible to the proxy on
  // every iframe navigation. Netlify is always HTTPS; None+Secure is valid.
  const cookieOptions = process.env.NODE_ENV === 'production'
    ? { sameSite: 'none' as const, secure: true }
    : undefined

  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    cookieOptions ? { cookieOptions } : {}
  )
}
