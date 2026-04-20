/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Auth callback — handles email-link returns for invite, password recovery,
 * signup confirmation, email change, and magic link.
 *
 * Supports two flows:
 *
 *   1. Server-side OTP (modern):  /auth/callback?token_hash=XXX&type=invite&next=/auth/accept-invite
 *      Email templates build this URL directly via {{ .TokenHash }}. The code
 *      here calls supabase.auth.verifyOtp() which sets the session cookie and
 *      redirects to `next`. This is the primary path and what invite /
 *      recovery emails use.
 *
 *   2. PKCE code exchange (legacy): /auth/callback?code=XXX&next=/somewhere
 *      Used by OAuth / social-login flows and anywhere Supabase emits a
 *      redirect with ?code=. Kept for backwards compatibility.
 *
 *   Implicit-flow fragments (#access_token=...) are NOT supported server-side —
 *   a fragment cannot be read by a server route. Email templates must use the
 *   token_hash URL shape above; legacy templates that still emit
 *   {{ .ConfirmationURL }} will land here with no code / no token_hash and
 *   fall through to the error redirect.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type')
  const next = url.searchParams.get('next') || '/dashboard'

  const supabase = await createClient()

  // --- Modern OTP flow (invite / recovery / signup / email_change / magiclink)
  if (tokenHash && rawType) {
    const type = rawType as EmailOtpType
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
    // Surface the real error via a query param so the signin page can show
    // something more useful than the generic "callback failed".
    console.error('[auth/callback] verifyOtp failed:', error.message)
    return NextResponse.redirect(
      new URL(`/auth/signin?error=${encodeURIComponent(error.message)}`, url.origin)
    )
  }

  // --- Legacy PKCE code exchange (social auth, etc.)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
    return NextResponse.redirect(
      new URL(`/auth/signin?error=${encodeURIComponent(error.message)}`, url.origin)
    )
  }

  // --- Nothing to exchange. Most likely cause: an old email template is still
  // emitting {{ .ConfirmationURL }} which sends the token in a URL fragment
  // (implicit flow) that the server cannot see. Update the template to use
  // {{ .TokenHash }} per docs/runbooks/supabase-auth-configuration.md.
  console.warn('[auth/callback] no code or token_hash — likely stale email template (implicit flow)')
  return NextResponse.redirect(
    new URL('/auth/signin?error=invite_link_missing_token', url.origin)
  )
}
