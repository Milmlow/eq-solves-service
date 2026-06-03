/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { publicEnv } from '@/lib/env'
import { shellCookieOptions } from '@/lib/auth/shell-cookies'
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
          // SameSite policy depends on the deploy host (see lib/auth/shell-cookies):
          // Lax when served under *.eq.solutions (same-site iframe with Shell —
          // the Cards/Field pattern), None as a cutover fallback on *.netlify.app.
          const sameSiteOverride = shellCookieOptions(request.nextUrl.host)
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
