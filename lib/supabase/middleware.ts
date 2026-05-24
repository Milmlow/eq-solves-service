/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env'
import type { Database } from './database.types'

/**
 * Refreshes the Supabase session on every request and returns the response
 * together with the authenticated user (if any) and their AAL level.
 *
 * Used by proxy.ts (Next 16 replacement for middleware.ts).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          // SameSite=None required in production: Service is embedded cross-site
          // inside Shell (core.eq.solutions ≠ eq-solves-service.netlify.app).
          // Lax cookies are not forwarded in cross-site sub-frame requests, so
          // the session would be invisible to the proxy on every iframe navigation.
          // Netlify is always HTTPS, so None+Secure is valid in production.
          const sameSiteOverride = process.env.NODE_ENV === 'production'
            ? { sameSite: 'none' as const, secure: true }
            : {}
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, ...sameSiteOverride })
          )
        },
      },
    }
  )

  // IMPORTANT: call getUser() — do not put logic between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch the user's AAL to know if MFA has been satisfied this session.
  let aal: { currentLevel: string | null; nextLevel: string | null } = {
    currentLevel: null,
    nextLevel: null,
  }
  if (user) {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    aal = {
      currentLevel: data?.currentLevel ?? null,
      nextLevel: data?.nextLevel ?? null,
    }
  }

  return { response, supabase, user, aal }
}
