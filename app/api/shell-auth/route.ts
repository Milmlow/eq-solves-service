// POST /api/shell-auth
//
// Validates a Shell-minted HMAC token (kind='service-token') and returns a
// one-time OTP the browser can exchange for a Supabase session via verifyOtp.
//
// Flow:
//   Shell mints token (mint-service-iframe-token) → embeds Service at
//   https://eq-solves-service.netlify.app/#sh=<token> → Service's /shell
//   page POSTs here → we validate + call admin.generateLink() → return OTP →
//   client calls supabase.auth.verifyOtp() → session established → redirect.
//
// Security notes:
// - HMAC signed with EQ_SECRET_SALT (same secret on both deploys).
// - Token TTL is 60s — one-shot exchange, not a long-lived credential.
// - generateLink() fails if the email is not in Service's auth.users.
//   Users must be provisioned in Service before iframe access is possible.
// - OTP is single-use (Supabase invalidates on first verify) and TTL-bound.

import { type NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const EQ_SECRET_SALT = process.env.EQ_SECRET_SALT ?? ''

interface ServiceTokenPayload {
  kind: 'service-token'
  email: string
  name: string | null
  eq_role: string
  is_platform_admin: boolean
  shell_tenant_id: string
  exp: number
}

function validateShellToken(raw: string): ServiceTokenPayload | null {
  if (!EQ_SECRET_SALT) return null
  const dot = raw.indexOf('.')
  if (dot === -1) return null
  const b64 = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const expected = createHmac('sha256', EQ_SECRET_SALT).update(json).digest('hex')
    if (expected.length !== sig.length) return null
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) return null
    const data = JSON.parse(json) as Partial<ServiceTokenPayload>
    if (data.kind !== 'service-token') return null
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    if (!data.email || typeof data.email !== 'string') return null
    return data as ServiceTokenPayload
  } catch {
    return null
  }
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!EQ_SECRET_SALT) {
    return json(500, { error: 'misconfigured', detail: 'EQ_SECRET_SALT not set on this deploy' })
  }

  let body: { token?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'bad-request' })
  }

  if (typeof body.token !== 'string') {
    return json(400, { error: 'bad-request', detail: 'token must be a string' })
  }

  const payload = validateShellToken(body.token)
  if (!payload) {
    return json(401, { error: 'invalid-token' })
  }

  const supabase = createAdminClient()

  // Generate a one-time magic link for the user. This validates that the
  // email exists in Service's auth.users — if not, the call returns an error
  // and we reject. Users must be provisioned in Service before iframe access.
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: payload.email,
  })

  if (linkErr || !linkData?.properties?.email_otp) {
    return json(403, {
      error: 'service-account-not-found',
      detail: 'This email is not registered in EQ Service. Ask your admin to provision your account.',
    })
  }

  // Return the OTP for the client to exchange via supabase.auth.verifyOtp.
  // Single-use, expires per Supabase's OTP TTL (typically 60s).
  //
  // Also set eq_shell_bridge cookie so proxy.ts can skip the MFA redirect
  // for this session — Shell already verified the user's identity via HMAC.
  // HttpOnly prevents JS manipulation; 4-hour TTL covers a normal work session.
  const resp = NextResponse.json(
    { email: payload.email, otp: linkData.properties.email_otp },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
  resp.cookies.set('eq_shell_bridge', '1', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 4, // 4 hours
  })
  return resp
}
