// GET /api/shell-sso?next=/dashboard
//
// Cookie-based Shell SSO exchange — runs in Node.js (not the edge runtime) so
// node:crypto and Buffer are available without restriction.
//
// Flow:
//   1. Middleware (proxy.ts) detects `eq_shell_session` cookie, redirects here.
//   2. This route verifies the HMAC, generates a Supabase magic-link OTP,
//      exchanges it for a session, and sets the session cookies + eq_shell_bridge.
//   3. Redirects to the `next` query param (default /dashboard).
//
// If anything fails (bad HMAC, Supabase error), redirects to /auth/signin so
// the user can log in normally.

import { type NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import { shellCookieOptions } from '@/lib/auth/shell-cookies'
import { provisionShellMemberships } from '@/lib/auth/shell-provision'

interface ShellCookiePayload {
  user_id: string
  tenant_id: string
  active_tenant_id: string
  role: string
  is_platform_admin: boolean
  memberships: Array<{ tenant_id: string; role: string; slug?: string }>
  email?: string
  name?: string | null
  exp: number
}

function verifyShellCookie(raw: string): ShellCookiePayload | null {
  // eq-shell signs session cookies with EQ_SESSION_SALT (falling back to EQ_SECRET_SALT).
  // Mirror the same priority here so HMAC verification succeeds on deploys where
  // EQ_SESSION_SALT is set on shell but EQ_SECRET_SALT is the legacy key on service.
  const salt = process.env.EQ_SESSION_SALT ?? process.env.EQ_SECRET_SALT
  if (!salt) return null
  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const b64 = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const expected = createHmac('sha256', salt).update(json).digest('hex')
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

export async function GET(request: NextRequest) {
  const nextParam = request.nextUrl.searchParams.get('next') ?? '/dashboard'
  const safePath = nextParam.startsWith('/') ? nextParam : '/dashboard'

  const siteBaseEarly = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${request.nextUrl.host}`
  // Debug: include a reason param so the failure is visible in the browser address bar
  // during development. The param is ignored by /auth/signin — safe to ship.
  const fail = (reason: string) => {
    // eslint-disable-next-line no-console
    console.error('[shell-sso] fail reason=%s', reason)
    const url = new URL('/auth/signin', siteBaseEarly)
    url.searchParams.set('sso_err', reason)
    return NextResponse.redirect(url)
  }

  // eslint-disable-next-line no-console
  console.log('[shell-sso] hit — host=%s cookies=%s', request.nextUrl.host,
    request.cookies.getAll().map(c => c.name).join(','))

  const rawShellCookie = request.cookies.get('eq_shell_session')?.value
  if (!rawShellCookie) return fail('no_cookie')

  const shellPayload = verifyShellCookie(rawShellCookie)
  if (!shellPayload) {
    // eslint-disable-next-line no-console
    console.error('[shell-sso] HMAC verify failed — session_salt=%s secret_salt=%s',
      !!process.env.EQ_SESSION_SALT, !!process.env.EQ_SECRET_SALT)
    return fail('hmac_fail')
  }

  const host = request.nextUrl.host
  const sameSiteOpts = shellCookieOptions(host)

  const supabaseAdmin = createAdminClient()

  // Generate a magic-link OTP. Auto-provision if the user doesn't exist yet.
  let { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: shellPayload.email!,
  })

  if (linkErr || !linkData?.properties?.hashed_token) {
    // eslint-disable-next-line no-console
    console.error('[shell-sso] generateLink err=%s — auto-provisioning user', linkErr?.message)
    const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: shellPayload.email!,
      email_confirm: true,
      user_metadata: shellPayload.name ? { full_name: shellPayload.name } : {},
    })
    if (createErr) {
      // eslint-disable-next-line no-console
      console.error('[shell-sso] createUser failed: %s', createErr.message)
    }
    const retry = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: shellPayload.email!,
    })
    linkData = retry.data
    linkErr = retry.error
  }

  if (linkErr || !linkData?.properties?.hashed_token) {
    // eslint-disable-next-line no-console
    console.error('[shell-sso] generateLink retry failed: %s', linkErr?.message)
    return fail('generate_link')
  }

  // Exchange OTP server-side. Use an SSR client that writes Supabase auth
  // cookies directly onto the redirect response.
  //
  // Build the redirect URL from NEXT_PUBLIC_SITE_URL rather than cloning
  // request.nextUrl — when the API route runs via the Netlify server handler,
  // nextUrl may carry the internal handler hostname instead of service.eq.solutions.
  const cookieStore = await cookies()
  const siteBase = process.env.NEXT_PUBLIC_SITE_URL ?? `https://${request.nextUrl.host}`
  const redirectRes = NextResponse.redirect(new URL(safePath, siteBase))

  const ssrClient = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectRes.cookies.set(name, value, {
              ...options,
              ...sameSiteOpts,
            })
          })
        },
      },
    }
  )

  const { error: otpErr } = await ssrClient.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  })

  if (otpErr) {
    // eslint-disable-next-line no-console
    console.error('[shell-sso] verifyOtp failed: %s', otpErr.message)
    return fail('verify_otp')
  }

  // Best-effort membership provisioning.
  await provisionShellMemberships(
    supabaseAdmin,
    linkData.user?.id ?? '',
    shellPayload.memberships,
  )

  // Stamp the bridge cookie so subsequent middleware calls skip the SSO redirect.
  redirectRes.cookies.set('eq_shell_bridge', '1', {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 4,
    ...sameSiteOpts,
  })

  return redirectRes
}
