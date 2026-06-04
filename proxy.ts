/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { updateSession } from '@/lib/supabase/middleware'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import { trackServer } from '@/lib/analytics-server'
import {
  PUBLIC_PATHS,
  MFA_PATHS,
  AAL_EXEMPT_PATHS,
  isPublicPath,
  isAalExempt,
} from '@/lib/auth/mfa-routing'
import { shellCookieOptions } from '@/lib/auth/shell-cookies'

// ---------------------------------------------------------------------------
// Shell cookie verification
// ---------------------------------------------------------------------------

interface ShellCookiePayload {
  user_id: string
  tenant_id: string
  active_tenant_id: string
  role: string
  is_platform_admin: boolean
  memberships: Array<{ tenant_id: string; role: string }>
  email?: string
  name?: string | null
  exp: number
}

/**
 * Parse and HMAC-verify the `eq_shell_session` cookie.
 * Returns the payload if valid; null otherwise (missing, tampered, expired,
 * or `email` absent — old cookies pre-2026-05-28 don't carry it).
 */
function verifyShellCookie(raw: string): ShellCookiePayload | null {
  const salt = process.env.EQ_SECRET_SALT
  if (!salt) return null
  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const b64 = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const expected = createHmac('sha256', salt).update(json).digest('hex')
    // timingSafeEqual requires equal-length buffers
    const expectedBuf = Buffer.from(expected, 'hex')
    const sigBuf = Buffer.from(sig, 'hex')
    if (expectedBuf.length !== sigBuf.length) return null
    if (!timingSafeEqual(expectedBuf, sigBuf)) return null
    const data = JSON.parse(json) as Partial<ShellCookiePayload>
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    if (!data.email || typeof data.email !== 'string') return null
    return data as ShellCookiePayload
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------

// Next.js 16 renamed `middleware.ts` → `proxy.ts` with a `proxy()` export.
// This file refreshes the Supabase session on every request, enforces
// authentication, MFA (AAL2), and admin-only routes.
//
// Path lists and pure routing helpers live in lib/auth/mfa-routing.ts so
// the AAL1 loop fix has a regression test (tests/lib/auth/mfa-routing.test.ts).

// Re-export so existing direct readers still resolve (keeps the call surface
// stable; new code should import from lib/auth/mfa-routing directly).
export { PUBLIC_PATHS, MFA_PATHS, AAL_EXEMPT_PATHS }

// MFA grace window — 14 days from first signin (`profiles.mfa_grace_started_at`).
// Exported so the banner component in (app)/layout.tsx can compute days-
// remaining off the same source of truth.
export const MFA_GRACE_DAYS = 14
const MFA_GRACE_MS = MFA_GRACE_DAYS * 24 * 60 * 60 * 1000

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ---------------------------------------------------------------------------
  // Fast path: cookie-based Shell SSO
  //
  // If the request carries a valid `eq_shell_session` cookie AND there is no
  // existing `eq_shell_bridge` flag, attempt to establish a Supabase session
  // server-side without the 5-step /shell → shell-auth round-trip.
  //
  // Conditions that skip this path (fall through to token flow):
  //   • `eq_shell_bridge=1` already set  → session already bootstrapped
  //   • `eq_shell_session` absent or HMAC-invalid
  //   • Cookie `exp` has lapsed
  //   • `email` field absent (old cookies minted before 2026-05-28)
  //   • `EQ_SECRET_SALT` not configured on this deploy
  // ---------------------------------------------------------------------------
  const alreadyBridged = request.cookies.get('eq_shell_bridge')?.value === '1'
  if (!alreadyBridged) {
    const rawShellCookie = request.cookies.get('eq_shell_session')?.value
    if (rawShellCookie) {
      const shellPayload = verifyShellCookie(rawShellCookie)
      if (shellPayload) {
        // Build a mutable response so we can set cookies while still
        // forwarding the request to the Next.js render pipeline.
        let cookieResponse = NextResponse.next({ request })
        // Lax under *.eq.solutions (same-site iframe), None fallback on
        // *.netlify.app — see lib/auth/shell-cookies.
        const sameSiteOpts = shellCookieOptions(request.nextUrl.host)

        const supabaseAdmin = createAdminClient()

        // Generate a magic-link OTP. Auto-provision if the user doesn't exist.
        let { data: linkData, error: linkErr } =
          await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: shellPayload.email!,
          })

        if (linkErr || !linkData?.properties?.hashed_token) {
          await supabaseAdmin.auth.admin.createUser({
            email: shellPayload.email!,
            email_confirm: true,
            user_metadata: shellPayload.name ? { full_name: shellPayload.name } : {},
          })
          const retry = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: shellPayload.email!,
          })
          linkData = retry.data
          linkErr = retry.error
        }

        if (!linkErr && linkData?.properties?.hashed_token) {
          // Exchange the OTP server-side using an SSR client that writes
          // the resulting Supabase auth cookies directly onto `cookieResponse`.
          const ssrClient = createServerClient(
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
                  cookieResponse = NextResponse.next({ request })
                  cookiesToSet.forEach(({ name, value, options }) =>
                    cookieResponse.cookies.set(name, value, {
                      ...options,
                      ...sameSiteOpts,
                    })
                  )
                },
              },
            }
          )

          // Verify by token_hash — GoTrue rejects the call with
          // "400: Only the token_hash and type should be provided" if `email`
          // is also passed (email belongs to the {email, token} OTP variant,
          // NOT the {token_hash} variant). Passing it here was silently failing
          // every Shell SSO exchange → no session → bounce to /auth/signin =
          // the "double login". Verified against live auth logs 2026-06-04.
          const { error: otpErr } = await ssrClient.auth.verifyOtp({
            type: 'magiclink',
            token_hash: linkData.properties.hashed_token,
          })

          if (!otpErr) {
            // Session established — stamp the bridge cookie and continue.
            // SameSite/Secure follow the deploy host (see shellCookieOptions).
            cookieResponse.cookies.set('eq_shell_bridge', '1', {
              httpOnly: true,
              path: '/',
              maxAge: 60 * 60 * 4, // 4 hours
              ...sameSiteOpts,
            })
            // Redirect public/auth pages to dashboard now that we have a session.
            if (isPublicPath(pathname)) {
              const url = request.nextUrl.clone()
              url.pathname = '/dashboard'
              const redirectRes = NextResponse.redirect(url)
              cookieResponse.cookies.getAll().forEach(({ name, value, ...opts }) =>
                redirectRes.cookies.set(name, value, opts)
              )
              return redirectRes
            }
            return cookieResponse
          }
          // OTP exchange failed — fall through to standard flow.
        }
        // generateLink failed — fall through to standard flow.
      }
    }
  }

  const { response, supabase, user, aal } = await updateSession(request)

  const isPublic = isPublicPath(pathname)
  const isAalExemptPath = isAalExempt(pathname)
  // isMfaPath is exported for callers that need it, but not used in this
  // middleware body — the AAL exemption check covers the same routes.

  // Unauthenticated users -> /auth/signin (except for public routes).
  if (!user) {
    if (isPublic) return response
    const url = request.nextUrl.clone()
    url.pathname = '/auth/signin'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // Demo accounts bypass MFA entirely.
  const isDemoUser = user.email === 'demo@eqsolves.com.au'

  // Shell iframe sessions bypass MFA — Shell already verified the user via HMAC.
  // The cookie is set by /api/shell-auth after a successful token exchange.
  const isShellSession = request.cookies.get('eq_shell_bridge')?.value === '1'

  // Authenticated users on public auth pages -> dashboard.
  if (isPublic && (aal.currentLevel === 'aal2' || isDemoUser || isShellSession)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // AAL enforcement:
  //   nextLevel === 'aal2' && currentLevel === 'aal1'  -> must challenge existing factor
  //   nextLevel === 'aal1' && currentLevel === 'aal1'  -> no factor enrolled yet
  if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2' && !isAalExemptPath && !isShellSession) {
    // Fire-and-forget observability: makes the MFA loop visible if it recurs.
    // Two of these within ~30s for the same user = suspected loop.
    trackServer(user.id, 'mfa_redirect', { from: pathname }).catch(() => {})
    const url = request.nextUrl.clone()
    url.pathname = '/auth/mfa'
    return NextResponse.redirect(url)
  }

  // Skip MFA enrollment for demo accounts (no factor enrolled yet).
  if (
    aal.currentLevel === 'aal1' &&
    aal.nextLevel === 'aal1' &&
    !isAalExemptPath &&
    !isDemoUser &&
    !isShellSession
  ) {
    // MFA grace window (PR J — UX audit §B.1 / §5.4, locked 2026-05-19).
    // Users without a factor enrolled get N=14 days from first signin
    // before the enroll-redirect kicks in. During grace, requests pass
    // through and a banner reminds the user (rendered by layout). After
    // grace, the redirect resumes its pre-PR-J behaviour.
    //
    // mfa_grace_started_at is stamped by migration 0103 — DEFAULT now()
    // on new profile inserts + backfilled on existing rows. So every
    // authenticated user has a non-null timestamp; treating null
    // defensively (no grace) maintains backward compat if the column
    // is missing.
    const { data: profile } = await supabase
      .from('profiles')
      .select('mfa_grace_started_at')
      .eq('id', user.id)
      .single()
    const graceStart = (profile as { mfa_grace_started_at?: string | null } | null)?.mfa_grace_started_at ?? null
    const inGrace =
      graceStart !== null &&
      Date.now() - new Date(graceStart).getTime() < MFA_GRACE_MS

    if (!inGrace) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/enroll-mfa'
      return NextResponse.redirect(url)
    }
    // else: within grace — let the request through. Banner renders in
    // (app)/layout.tsx.
  }

  // Admin-only routes — gated by the user's per-tenant role.
  // Pre-2026-04-30 this read `profiles.role`, which diverged from how
  // individual admin pages already gated themselves (they read
  // `tenant_members.role` via `isAdmin()`). Net effect was a privilege
  // model split (Issue #19 from the overnight battle-test): a user with
  // `profiles.role = super_admin` could reach /admin URLs but get
  // redirected at content-level by the per-page check. Aligned here so
  // both layers agree on the same canonical role source.
  // Profile-level deactivation is still checked by the block below for
  // ALL protected routes — no need to duplicate it here.
  if (pathname.startsWith('/admin')) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('role', 'manager')
      .limit(1)
      .maybeSingle()

    if (!membership) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  // Deactivated users are signed out on any protected route.
  if (!isPublic && !isAalExemptPath) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', user.id)
      .single()
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/auth/signin'
      url.searchParams.set('error', 'deactivated')
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Match all paths except Next internals and static assets.
    // PDF / DOCX are excluded so sample reports in /public/samples serve
    // straight from the CDN without a Supabase session round-trip (which
    // would otherwise bounce unauthenticated visitors back to /auth/signin).
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf|docx)$).*)',
  ],
}
