/**
 * Unit tests for lib/auth/shell-bridge.ts
 *
 * Covers the HMAC validation logic in isolation — no Supabase calls, no
 * route handler. Run with: npx vitest run tests/lib/auth/shell-bridge.test.ts
 */

import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { validateShellBridgeToken, type ShellBridgeToken } from '@/lib/auth/shell-bridge'

const SECRET = 'test-secret-256-bits-long-enough-for-hmac'

/** Build a valid token for the given payload override. */
function mintToken(override: Partial<ShellBridgeToken & { exp: number }> = {}): string {
  const payload: ShellBridgeToken = {
    iss:         'eq-shell',
    aud:         'service',
    email:       'royce@eq.solutions',
    tenant_slug: 'sks',
    exp:         Date.now() + 60_000,
    ...override,
  }
  const json = JSON.stringify(payload)
  const b64  = Buffer.from(json).toString('base64url')
  const sig  = createHmac('sha256', SECRET).update(json).digest('hex')
  return `${b64}.${sig}`
}

describe('validateShellBridgeToken', () => {
  it('accepts a valid token', () => {
    const result = validateShellBridgeToken(mintToken(), SECRET)
    expect(result).not.toBeNull()
    expect(result?.email).toBe('royce@eq.solutions')
    expect(result?.tenant_slug).toBe('sks')
    expect(result?.aud).toBe('service')
  })

  it('rejects an expired token', () => {
    const token = mintToken({ exp: Date.now() - 1_000 })
    expect(validateShellBridgeToken(token, SECRET)).toBeNull()
  })

  it('rejects a token with wrong audience', () => {
    // @ts-expect-error — intentionally wrong aud for test
    const token = mintToken({ aud: 'field' })
    expect(validateShellBridgeToken(token, SECRET)).toBeNull()
  })

  it('rejects a token with wrong issuer', () => {
    // @ts-expect-error — intentionally wrong iss for test
    const token = mintToken({ iss: 'eq-cards' })
    expect(validateShellBridgeToken(token, SECRET)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = mintToken()
    expect(validateShellBridgeToken(token, 'wrong-secret')).toBeNull()
  })

  it('rejects a tampered payload (signature mismatch)', () => {
    const token  = mintToken()
    const parts  = token.split('.')
    // Replace the base64 payload with a different one
    const evil   = Buffer.from(JSON.stringify({
      iss: 'eq-shell', aud: 'service', email: 'evil@example.com',
      tenant_slug: 'sks', exp: Date.now() + 60_000,
    })).toString('base64url')
    const tampered = `${evil}.${parts[parts.length - 1]}`
    expect(validateShellBridgeToken(tampered, SECRET)).toBeNull()
  })

  it('rejects a token with missing email', () => {
    // Build raw without email
    const json = JSON.stringify({ iss: 'eq-shell', aud: 'service', tenant_slug: 'sks', exp: Date.now() + 60_000 })
    const b64  = Buffer.from(json).toString('base64url')
    const sig  = createHmac('sha256', SECRET).update(json).digest('hex')
    expect(validateShellBridgeToken(`${b64}.${sig}`, SECRET)).toBeNull()
  })

  it('rejects a token with missing tenant_slug', () => {
    const json = JSON.stringify({ iss: 'eq-shell', aud: 'service', email: 'x@y.com', exp: Date.now() + 60_000 })
    const b64  = Buffer.from(json).toString('base64url')
    const sig  = createHmac('sha256', SECRET).update(json).digest('hex')
    expect(validateShellBridgeToken(`${b64}.${sig}`, SECRET)).toBeNull()
  })

  it('rejects an empty token string', () => {
    expect(validateShellBridgeToken('', SECRET)).toBeNull()
  })

  it('rejects when secret is empty', () => {
    expect(validateShellBridgeToken(mintToken(), '')).toBeNull()
  })

  it('rejects a token with no dot separator', () => {
    expect(validateShellBridgeToken('nodotinhere', SECRET)).toBeNull()
  })

  it('rejects a token with invalid base64', () => {
    expect(validateShellBridgeToken('!!!invalid!!!.abc123', SECRET)).toBeNull()
  })

  it('rejects a token with invalid JSON payload', () => {
    const b64 = Buffer.from('not json at all').toString('base64url')
    const sig = createHmac('sha256', SECRET).update('not json at all').digest('hex')
    expect(validateShellBridgeToken(`${b64}.${sig}`, SECRET)).toBeNull()
  })
})
