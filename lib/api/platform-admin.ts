import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'

/**
 * Guards the out-of-band platform-provisioning endpoints (e.g. /api/tenants).
 *
 * Cross-tenant operations — creating, updating, or deactivating tenants — are
 * NOT a tenant-held role (migration 0114 removed cross-tenant super_admin).
 * They run only via EQ-internal tooling that presents a shared platform secret
 * in the `x-eq-platform-key` header. The endpoint uses the Supabase service
 * role (RLS-bypassing) once this check passes.
 *
 * Returns:
 *   - 'ok'           → header present and correct; proceed with service role.
 *   - 'unconfigured' → EQ_PLATFORM_ADMIN_KEY not set on this deploy (→ 503).
 *   - 'denied'       → header missing or wrong (→ 403). Never reachable by a
 *                      tenant-user session — there is no role that grants it.
 *
 * Comparison is constant-time over an HMAC of each side so neither length nor
 * content leaks via timing.
 */
export function checkPlatformKey(request: NextRequest): 'ok' | 'unconfigured' | 'denied' {
  const expected = serverEnv().EQ_PLATFORM_ADMIN_KEY
  if (!expected) return 'unconfigured'

  const provided = request.headers.get('x-eq-platform-key') ?? ''

  // HMAC both sides to a fixed-length digest so timingSafeEqual is well-defined
  // regardless of input length, and raw secrets never drive the comparison.
  const salt = 'eq-platform-key'
  const a = createHmac('sha256', salt).update(expected).digest()
  const b = createHmac('sha256', salt).update(provided).digest()
  return timingSafeEqual(a, b) ? 'ok' : 'denied'
}
