/**
 * Shell → Service bridge token validation.
 *
 * The EQ Shell mints a 60-second HMAC-signed token when a user clicks the
 * Service tile from the shell nav. Service validates it at /auth/shell-bridge,
 * looks up the user + tenant, generates a Supabase magic link, and redirects
 * the user through the Supabase callback to land a real session cookie.
 *
 * This is Option B (auth-share + redirect) from docs/audits/2026-05-19-eq-shell-integration.md.
 * Unlike the iframe flow (/shell + /api/shell-auth which uses EQ_SECRET_SALT),
 * this route uses a dedicated EQ_SHELL_BRIDGE_SECRET so service tokens can't
 * be replayed against field, and vice versa.
 *
 * ── Token format ──────────────────────────────────────────────────────────────
 *
 *   <base64url(JSON)>.<hmac-sha256-hex>
 *
 *   JSON payload:
 *   {
 *     iss: 'eq-shell',        // issuer — must match exactly
 *     aud: 'service',         // audience — guards against cross-module replay
 *     email: string,          // user's email (lowercased)
 *     tenant_slug: string,    // e.g. 'sks' — must match tenants.slug in Service
 *     exp: number,            // Unix milliseconds, 60s window
 *   }
 *
 *   The HMAC is computed over the raw JSON string (not the base64), keyed
 *   with EQ_SHELL_BRIDGE_SECRET. The shell-side mint-iframe-token must use
 *   the same key and the same algorithm.
 *
 * ── Security properties ───────────────────────────────────────────────────────
 *
 *   - Timing-safe comparison via timingSafeEqual prevents timing oracle attacks.
 *   - 60-second TTL — one-shot, short enough to prevent token accumulation.
 *   - aud='service' — a token minted for Field cannot be accepted here.
 *   - Token travels in query param (?sh=), not the URL hash, so it's in
 *     server access logs. Secret rotation should happen if a token is
 *     ever accidentally logged with PII.
 *   - Route returns 404 when EQ_SHELL_BRIDGE_SECRET is unset — safe default.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Token schema
// ─────────────────────────────────────────────────────────────────────────────

const ShellBridgeTokenSchema = z.object({
  iss:         z.literal('eq-shell'),
  aud:         z.literal('service'),
  email:       z.string().email(),
  tenant_slug: z.string().min(1).max(64),
  exp:         z.number().int().positive(),
})

export type ShellBridgeToken = z.infer<typeof ShellBridgeTokenSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a shell bridge token. Returns the parsed payload on success, or
 * null on any failure (bad signature, expired, wrong issuer/audience, missing
 * or malformed claims).
 *
 * Never throws — all failures return null so the route can produce a consistent
 * 401 response without leaking which check failed.
 *
 * @param raw    - Raw token string: `<base64url-json>.<hmac-hex>`
 * @param secret - EQ_SHELL_BRIDGE_SECRET from env
 */
export function validateShellBridgeToken(
  raw: string,
  secret: string,
): ShellBridgeToken | null {
  if (!secret || !raw) return null

  // Split on the LAST dot so the payload itself can contain dots
  const dot = raw.lastIndexOf('.')
  if (dot === -1 || dot === 0 || dot === raw.length - 1) return null

  const b64 = raw.slice(0, dot)
  const sig  = raw.slice(dot + 1)

  // Decode base64url payload
  let json: string
  try {
    json = Buffer.from(b64, 'base64url').toString('utf8')
  } catch {
    return null
  }

  // HMAC is computed over the raw JSON, not the base64 representation.
  // This matches how the shell side mints the token.
  const expected = createHmac('sha256', secret).update(json).digest('hex')

  // Timing-safe comparison — prevents timing oracle on the HMAC
  try {
    const expectedBuf = Buffer.from(expected)
    const sigBuf      = Buffer.from(sig)
    if (expectedBuf.length !== sigBuf.length) return null
    if (!timingSafeEqual(expectedBuf, sigBuf)) return null
  } catch {
    return null
  }

  // Parse JSON
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }

  // Validate schema (iss, aud, email, tenant_slug, exp)
  const parsed = ShellBridgeTokenSchema.safeParse(data)
  if (!parsed.success) return null

  // Expiry — exp is Unix milliseconds
  if (parsed.data.exp < Date.now()) return null

  return parsed.data
}
