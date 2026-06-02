// POST /api/shell-auth
//
// Validates a Shell-minted HMAC token and returns a one-time OTP the browser
// can exchange for a Supabase session via verifyOtp.
//
// Accepts three token formats (transition window):
//
// BRIDGE FORMAT (preferred — minted by mint-iframe-token?aud=service, PR #130):
//   base64url(JSON) + '.' + hex(HMAC-SHA256(EQ_SHELL_BRIDGE_SECRET))
//   Payload: { iss: 'eq-shell', aud: 'service', email, tenant_slug, exp }
//   Uses a dedicated secret scoped to Shell↔Service — EQ_SECRET_SALT is
//   shared with Field and must not be treated as Service-specific.
//
// SUPABASE JWT FORMAT (Phase 3 — direct Supabase session token):
//   Standard HS256 JWT signed with SUPABASE_JWT_SECRET
//   Payload: { sub, exp, app_metadata: { tenant_id, eq_role, is_platform_admin, email } }
//
// LEGACY FORMAT (fallback — minted by mint-service-iframe-token):
//   base64(JSON) + '.' + hex(HMAC-SHA256(EQ_SECRET_SALT))
//   Payload: { kind: 'service-token', email, name, eq_role, is_platform_admin, shell_tenant_id, exp }
//   Remove once Shell is fully deployed on the new format.
//
// Flow:
//   Shell mints token → embeds Service at /shell#sh=<token> → Service's /shell
//   page POSTs here → we validate + call admin.generateLink() → return OTP →
//   client calls supabase.auth.verifyOtp() → session established → redirect.
//
// Security notes:
// - HMAC signed; bridge token uses EQ_SHELL_BRIDGE_SECRET (not shared with Field).
// - Token TTL is 60s — one-shot exchange, not a long-lived credential.
// - generateLink() auto-provisions the user if they don't exist yet — Shell's
//   HMAC vouches for their identity, so Service creates the account on first access.
// - OTP is single-use (Supabase invalidates on first verify) and TTL-bound.

import { type NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const EQ_SHELL_BRIDGE_SECRET = process.env.EQ_SHELL_BRIDGE_SECRET ?? ''
const EQ_SECRET_SALT = process.env.EQ_SECRET_SALT ?? ''
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

// ── Bridge token (preferred) ──────────────────────────────────────────────────

interface BridgeTokenPayload {
  iss: 'eq-shell'
  aud: 'service'
  email: string
  tenant_slug: string
  exp: number
}

function validateBridgeToken(raw: string): BridgeTokenPayload | null {
  if (!EQ_SHELL_BRIDGE_SECRET) return null
  const dot = raw.indexOf('.')
  if (dot === -1) return null
  const b64url = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    const json = Buffer.from(b64url, 'base64url').toString('utf8')
    const expected = createHmac('sha256', EQ_SHELL_BRIDGE_SECRET).update(json).digest('hex')
    if (expected.length !== sig.length) return null
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) return null
    const data = JSON.parse(json) as Partial<BridgeTokenPayload>
    if (data.iss !== 'eq-shell' || data.aud !== 'service') return null
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    if (!data.email || typeof data.email !== 'string') return null
    if (!data.tenant_slug || typeof data.tenant_slug !== 'string') return null
    return data as BridgeTokenPayload
  } catch {
    return null
  }
}

// ── Legacy token (fallback) ───────────────────────────────────────────────────
// TODO: remove once Shell PRs #128/#130 are deployed and EQ_SHELL_BRIDGE_SECRET
// is confirmed set on both Shell and Service Netlify environments.

interface LegacyServiceTokenPayload {
  kind: 'service-token'
  email: string
  name: string | null
  eq_role: string
  is_platform_admin: boolean
  shell_tenant_id: string
  exp: number
}

function validateLegacyToken(raw: string): LegacyServiceTokenPayload | null {
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
    const data = JSON.parse(json) as Partial<LegacyServiceTokenPayload>
    if (data.kind !== 'service-token') return null
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    if (!data.email || typeof data.email !== 'string') return null
    return data as LegacyServiceTokenPayload
  } catch {
    return null
  }
}

// ── Supabase JWT (Phase 3) ────────────────────────────────────────────────────

function isJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    return header.alg === 'HS256'
  } catch {
    return false
  }
}

interface SupabaseJwtPayload {
  sub: string
  exp: number
  app_metadata: {
    tenant_id?: string
    eq_role?: string
    is_platform_admin?: boolean
    email?: string
  }
}

function validateSupabaseJwt(raw: string): SupabaseJwtPayload | null {
  if (!SUPABASE_JWT_SECRET) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    const signingInput = `${parts[0]}.${parts[1]}`
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(signingInput).digest('base64url')
    const sig = parts[2]
    if (expected.length !== sig.length) return null
    if (!timingSafeEqual(Buffer.from(expected, 'base64url'), Buffer.from(sig, 'base64url'))) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Partial<SupabaseJwtPayload>
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    if (!payload.sub || typeof payload.sub !== 'string') return null
    if (!payload.app_metadata || typeof payload.app_metadata !== 'object') return null
    return payload as SupabaseJwtPayload
  } catch {
    return null
  }
}

// ── EQ canonical → Service role mapping (C6) ─────────────────────────────────
//
// EQ canonical roles (from @eq-solutions/roles):
//   manager | supervisor | employee | apprentice | labour_hire
//   + is_platform_admin override (cross-tenant EQ staff)
//
// Service internal roles (lib/types/index.ts):
//   super_admin | admin | supervisor | technician | read_only
//
// Mapping rationale:
//   manager      → admin       (full tenant admin; super_admin reserved for EQ staff)
//   supervisor   → supervisor  (same concept — oversees technicians, creates work orders)
//   employee     → technician  (does test/maintenance work on-site)
//   apprentice   → read_only   (view-only until accredited)
//   labour_hire  → read_only   (scoped — no write permissions in Service)
//   is_platform_admin → super_admin (cross-tenant; EQ internal staff only)

type ServiceRole = 'super_admin' | 'admin' | 'supervisor' | 'technician' | 'read_only'

const EQ_TO_SERVICE_ROLE: Record<string, ServiceRole> = {
  manager:     'admin',
  supervisor:  'supervisor',
  employee:    'technician',
  apprentice:  'read_only',
  labour_hire: 'read_only',
}

function mapEqRoleToServiceRole(eqRole: string, isPlatformAdmin: boolean): ServiceRole {
  if (isPlatformAdmin) return 'super_admin'
  return EQ_TO_SERVICE_ROLE[eqRole] ?? 'read_only'
}

// ─────────────────────────────────────────────────────────────────────────────

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!EQ_SHELL_BRIDGE_SECRET && !EQ_SECRET_SALT) {
    return json(500, { error: 'misconfigured', detail: 'No shell token secret configured on this deploy' })
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

  // Bridge format preferred; Supabase JWT second; fall back to legacy during the migration window.
  const bridge = validateBridgeToken(body.token)
  const jwtClaims = (!bridge && isJwt(body.token)) ? validateSupabaseJwt(body.token) : null
  const legacy = (!bridge && !jwtClaims) ? validateLegacyToken(body.token) : null
  const email = bridge?.email ?? jwtClaims?.app_metadata?.email ?? legacy?.email

  if (!email) {
    return json(401, { error: 'invalid-token' })
  }

  // Extract role claims from whichever token format validated.
  // Bridge token does NOT carry role claims (design gap — slug only).
  // JWT (active Phase 3 path) and legacy both carry eq_role + is_platform_admin.
  const rawEqRole = jwtClaims?.app_metadata?.eq_role ?? legacy?.eq_role ?? null
  const isPlatformAdmin = jwtClaims?.app_metadata?.is_platform_admin ?? legacy?.is_platform_admin ?? false
  const serviceRole: ServiceRole | null = rawEqRole
    ? mapEqRoleToServiceRole(rawEqRole, isPlatformAdmin)
    : null

  // For bridge tokens, tenant_slug is available — needed for tenant_members upsert.
  const tenantSlug = bridge?.tenant_slug ?? null

  const supabase = createAdminClient()

  // Generate a one-time magic link. If the user doesn't exist yet, auto-provision
  // them — Shell's HMAC vouches for their identity.
  let { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkErr || !linkData?.properties?.email_otp) {
    // Auto-provision: create the user then retry. Ignore "already exists" errors
    // since the user may exist but generateLink failed for a transient reason.
    const displayName = legacy?.name ?? null
    await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: displayName ? { full_name: displayName } : {},
    })
    const retry = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    linkData = retry.data
    linkErr = retry.error
  }

  if (linkErr || !linkData?.properties?.email_otp) {
    return json(403, {
      error: 'service-account-not-found',
      detail: 'Could not provision access for this account. Contact support.',
    })
  }

  // ── Post-provisioning: sync role into Service's profile ───────────────────
  //
  // The handle_new_user() trigger creates a profiles row defaulting to
  // role='technician'. If we have role claims from the token, override with
  // the correctly-mapped Service role so the user lands with the right access.
  //
  // profiles.role is the "global" role; per-tenant access also requires a
  // tenant_members row. For bridge-token paths (tenant_slug available) we
  // upsert tenant_members too. For JWT paths, tenant_members provisioning
  // is deferred until slug is added to the iframe JWT (Sprint 6 — requires
  // token-exchange.ts to include tenant_slug for aud=service).
  const userId = linkData.user?.id
  if (userId && serviceRole) {
    void (async () => {
      try {
        await supabase.from('profiles').update({ role: serviceRole }).eq('id', userId)

        if (tenantSlug) {
          // Look up the Service tenant by slug, then upsert tenant_members.
          const { data: tenant } = await supabase
            .from('tenants')
            .select('id')
            .eq('slug', tenantSlug)
            .eq('is_active', true)
            .maybeSingle()

          if (tenant?.id) {
            await supabase.from('tenant_members').upsert(
              {
                user_id: userId,
                tenant_id: tenant.id,
                role: serviceRole,
                is_active: true,
              },
              { onConflict: 'user_id,tenant_id', ignoreDuplicates: false },
            )
          }
        }
      } catch (err) {
        // Non-blocking: provisioning failure doesn't break the OTP exchange.
        console.error('[shell-auth] post-provision role sync failed:', err)
      }
    })()
  }

  // Return the OTP for the client to exchange via supabase.auth.verifyOtp.
  // Single-use, expires per Supabase's OTP TTL (typically 60s).
  //
  // Also set eq_shell_bridge cookie so proxy.ts can skip the MFA redirect
  // for this session — Shell already verified the user's identity via HMAC.
  // HttpOnly prevents JS manipulation; 4-hour TTL covers a normal work session.
  const resp = NextResponse.json(
    { email, otp: linkData.properties.email_otp },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
  resp.cookies.set('eq_shell_bridge', '1', {
    httpOnly: true,
    secure: true,
    // SameSite=None required: Service is embedded cross-site inside Shell
    // (core.eq.solutions ≠ eq-solves-service.netlify.app). SameSite=Lax cookies
    // are not sent in cross-site sub-frame requests, so the MFA bypass in
    // proxy.ts would never see this flag. Secure is already true; Netlify is
    // always HTTPS so the None+Secure combination is valid in production.
    sameSite: 'none',
    path: '/',
    maxAge: 60 * 60 * 4, // 4 hours
  })
  return resp
}
