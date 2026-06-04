import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'

/**
 * Out-of-band platform-admin gate (Sprint C6).
 *
 * Genuine platform operations — provisioning, listing, editing and
 * deactivating *tenants themselves* — must NEVER be reachable through a
 * tenant-held role. A `super_admin` is, by design, only a tenant-scoped
 * manager; cross-tenant power lives here instead, behind a shared secret
 * that EQ platform staff hold, paired with the service-role Supabase client
 * (which bypasses RLS for these routes only).
 *
 * The caller proves they hold the platform key via the
 * `x-eq-platform-admin-key` request header. The check is:
 *   - FAIL CLOSED when EQ_PLATFORM_ADMIN_KEY is unset (an unconfigured deploy
 *     can never accidentally expose tenant management),
 *   - constant-time compared (timingSafeEqual) to avoid leaking the key
 *     length / prefix through response timing.
 *
 * Returns true only on an exact match. Handlers translate false into a 403.
 */
const PLATFORM_ADMIN_HEADER = 'x-eq-platform-admin-key'

export function isPlatformAdminRequest(request: NextRequest): boolean {
  const expected = serverEnv().EQ_PLATFORM_ADMIN_KEY
  // Fail closed: no key configured ⇒ surface stays shut.
  if (!expected) return false

  const provided = request.headers.get(PLATFORM_ADMIN_HEADER)
  if (!provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch — guard first so a wrong-length
  // key is a plain mismatch, not an exception.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
