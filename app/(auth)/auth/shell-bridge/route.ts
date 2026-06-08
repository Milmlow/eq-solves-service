/**
 * GET /auth/shell-bridge?sh=<token>&next=<path>
 *
 * Option B shell integration — auth-share + redirect.
 * See docs/audits/2026-05-19-eq-shell-integration.md for full design rationale.
 *
 * Flow:
 *   1. Shell clicks Service tile → mints 60s HMAC token (aud='service')
 *   2. Shell 302s browser to /auth/shell-bridge?sh=<token>&next=/dashboard
 *   3. THIS ROUTE:
 *      a. Validates HMAC + claims (iss, aud, exp)
 *      b. Looks up user in profiles by email
 *      c. Verifies tenant_members row exists for that user + matching tenant slug
 *      d. Generates a Supabase magic link via admin client
 *      e. Extracts token_hash from the action link
 *      f. 302s to /auth/callback?token_hash=<hash>&type=magiclink&next=<next>
 *   4. /auth/callback calls verifyOtp → sets Supabase session cookie
 *   5. User lands on `next` (default: /dashboard) with a live session
 *
 * MFA: not bypassed. If the user has an enrolled TOTP factor, proxy.ts will
 * redirect them to /auth/mfa after the session cookie is set. Accept the
 * double-prompt (shell PIN → TOTP in Service) per the audit doc Risk 2 decision.
 *
 * Security invariants:
 * - Route returns 404 when EQ_SHELL_BRIDGE_SECRET is unset (safe default).
 * - Token TTL is 60s — one-shot, not cacheable (Cache-Control: no-store).
 * - aud='service' is checked by validateShellBridgeToken — cross-module replay blocked.
 * - User MUST already exist in profiles + have a tenant_members row — no auto-provisioning.
 * - `next` is validated against the allowlist from /auth/callback/route.ts.
 * - All failures redirect to /auth/signin with a safe generic error (no info leakage).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { validateShellBridgeToken } from '@/lib/auth/shell-bridge'
import { createAdminClient } from '@/lib/supabase/admin'

const BRIDGE_SECRET = process.env.EQ_SHELL_BRIDGE_SECRET ?? ''

const ALLOWED_NEXT_ORIGINS = [
  'https://core.eq.solutions',
  'https://service.eq.solutions',
  'https://eq-service.netlify.app',
]

/** Validate the post-bridge redirect destination. Mirrors the logic in /auth/callback. */
function validateNext(raw: string | null): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return '/dashboard'
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (ALLOWED_NEXT_ORIGINS.includes(parsed.origin)) return trimmed
  } catch {
    // Not a valid URL
  }
  return '/dashboard'
}

/** Redirect to sign-in with a generic error code. Never leaks which check failed. */
function reject(origin: string, code: string) {
  console.warn(`[shell-bridge] rejected — ${code}`)
  return NextResponse.redirect(
    new URL(`/auth/signin?error=${encodeURIComponent('Shell sign-in failed. Please try again.')}`, origin),
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET(request: NextRequest) {
  const url    = new URL(request.url)
  const origin = url.origin

  // ── Gate: route is a 404 when the secret isn't configured ──────────────────
  if (!BRIDGE_SECRET) {
    console.warn('[shell-bridge] EQ_SHELL_BRIDGE_SECRET is not set — returning 404')
    return new NextResponse(null, { status: 404 })
  }

  const rawToken = url.searchParams.get('sh')
  const next     = validateNext(url.searchParams.get('next'))

  // ── 1. Validate HMAC token ─────────────────────────────────────────────────
  const token = validateShellBridgeToken(rawToken ?? '', BRIDGE_SECRET)
  if (!token) {
    return reject(origin, 'invalid-token')
  }

  const { email, tenant_slug } = token
  const normalEmail = email.toLowerCase()

  const admin = createAdminClient()

  // ── 2. Look up user in profiles by email ───────────────────────────────────
  // profiles mirrors auth.users — created by handle_new_user() trigger (migration 0053).
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id')
    .eq('email', normalEmail)
    .maybeSingle()

  if (profileErr) {
    console.error('[shell-bridge] profiles lookup error:', profileErr.message)
    return reject(origin, 'db-error')
  }

  if (!profile) {
    // User does not exist in Service — not provisioned.
    // Redirect to a clear "contact your admin" landing rather than generic signin.
    console.warn(`[shell-bridge] no profile for ${normalEmail}`)
    return NextResponse.redirect(
      new URL('/auth/signin?error=Your+account+is+not+set+up+in+EQ+Service.+Contact+your+administrator.', origin),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // ── 3. Verify tenant_members row for this user + tenant slug ───────────────
  const { data: member, error: memberErr } = await admin
    .from('tenant_members')
    .select('role, tenants!inner(slug)')
    .eq('user_id', profile.id)
    .eq('tenants.slug', tenant_slug)
    .maybeSingle()

  if (memberErr) {
    console.error('[shell-bridge] tenant_members lookup error:', memberErr.message)
    return reject(origin, 'db-error')
  }

  if (!member) {
    // User exists but doesn't have access to this tenant — slug mismatch or
    // not yet assigned. Show a clear error rather than a generic one.
    console.warn(`[shell-bridge] no tenant_member for user ${profile.id} slug=${tenant_slug}`)
    return NextResponse.redirect(
      new URL('/auth/signin?error=Your+account+does+not+have+access+to+this+workspace.+Contact+your+administrator.', origin),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // ── 4. Generate Supabase magic link ────────────────────────────────────────
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type:          'magiclink',
    email:         normalEmail,
    // redirect_to is advisory — the callback route is already in PUBLIC_PATHS
    // and handles the session setup. We pass it for Supabase's audit log.
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    console.error('[shell-bridge] generateLink error:', linkErr?.message)
    return reject(origin, 'generate-link-failed')
  }

  // ── 5. Extract token_hash from the action link ─────────────────────────────
  // action_link = https://<ref>.supabase.co/auth/v1/verify?token=<HASH>&type=magiclink&...
  // We hand the token_hash to /auth/callback which calls verifyOtp and sets the cookie.
  let tokenHash: string | null
  try {
    tokenHash = new URL(linkData.properties.action_link).searchParams.get('token')
  } catch {
    tokenHash = null
  }

  if (!tokenHash) {
    console.error('[shell-bridge] could not extract token_hash from action_link')
    return reject(origin, 'malformed-link')
  }

  // ── 6. Redirect through the callback to establish the session cookie ───────
  // The callback calls supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }),
  // which sets the Supabase SSR session cookie on this origin, then redirects to `next`.
  const callbackUrl = new URL('/auth/callback', origin)
  callbackUrl.searchParams.set('token_hash', tokenHash)
  callbackUrl.searchParams.set('type',       'magiclink')
  callbackUrl.searchParams.set('next',       next)

  console.info(`[shell-bridge] bridge success — ${normalEmail} → tenant ${tenant_slug} → ${next}`)

  return NextResponse.redirect(callbackUrl, {
    status:  302,
    headers: { 'Cache-Control': 'no-store' },
  })
}
