import { createHmac, timingSafeEqual } from 'node:crypto'

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

export interface ServiceJwtClaims {
  sub: string
  exp: number
  app_metadata: {
    tenant_id?: string
    eq_role?: string
    is_platform_admin?: boolean
    email?: string
    tenant_slug?: string
  }
}

/**
 * Verifies a Supabase-compatible JWT signed with SUPABASE_JWT_SECRET.
 * Returns decoded claims or null if the signature is invalid or the token is expired.
 */
export function verifyServiceJwt(raw: string): ServiceJwtClaims | null {
  if (!SUPABASE_JWT_SECRET) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    const signingInput = `${parts[0]}.${parts[1]}`
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(signingInput).digest('base64url')
    if (expected.length !== parts[2].length) return null
    if (!timingSafeEqual(Buffer.from(expected, 'base64url'), Buffer.from(parts[2], 'base64url'))) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Partial<ServiceJwtClaims>
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    if (!payload.sub || typeof payload.sub !== 'string') return null
    if (!payload.app_metadata || typeof payload.app_metadata !== 'object') return null
    return payload as ServiceJwtClaims
  } catch {
    return null
  }
}

/**
 * Mints a long-lived Supabase-compatible JWT from the given claims.
 * Used by shell-auth to convert the 60s iframe token into a 4h session cookie.
 */
export function mintServiceJwt(from: ServiceJwtClaims, ttlSeconds: number): string {
  if (!SUPABASE_JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET not set')
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    iss: 'supabase',
    sub: from.sub,
    iat: now,
    exp: now + ttlSeconds,
    app_metadata: from.app_metadata,
  })).toString('base64url')
  const sig = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
