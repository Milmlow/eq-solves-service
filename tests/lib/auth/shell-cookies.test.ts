import { describe, it, expect, vi, afterEach } from 'vitest'
import { isEqSolutionsHost, shellCookieOptions } from '@/lib/auth/shell-cookies'

// The "double login" root cause: Service was served cross-site with Shell
// (eq-solves-service.netlify.app inside core.eq.solutions), so its session +
// eq_shell_bridge cookies had to be SameSite=None — which Safari ITP / Chrome
// third-party-cookie blocking drop, killing the session and forcing a second
// sign-in.
//
// The fix moves Service onto *.eq.solutions (same-site with Shell, the Cards
// pattern) and switches the cookies to SameSite=Lax there. This is host-based
// so it flips automatically at DNS cutover. If anyone regresses the host check
// or the Lax/None mapping, these tests fail.

describe('shell-cookies — host-based SameSite policy', () => {
  describe('isEqSolutionsHost', () => {
    it('matches the service subdomain (target deploy host)', () => {
      expect(isEqSolutionsHost('service.eq.solutions')).toBe(true)
    })
    it('matches sibling EQ apps + the apex', () => {
      expect(isEqSolutionsHost('core.eq.solutions')).toBe(true)
      expect(isEqSolutionsHost('cards.eq.solutions')).toBe(true)
      expect(isEqSolutionsHost('eq.solutions')).toBe(true)
    })
    it('is port-tolerant', () => {
      expect(isEqSolutionsHost('service.eq.solutions:443')).toBe(true)
    })
    it('does NOT match the netlify fallback host', () => {
      expect(isEqSolutionsHost('eq-solves-service.netlify.app')).toBe(false)
    })
    it('does NOT match a look-alike suffix (eq.solutions.evil.com)', () => {
      expect(isEqSolutionsHost('eq.solutions.evil.com')).toBe(false)
    })
    it('handles null/empty safely', () => {
      expect(isEqSolutionsHost(null)).toBe(false)
      expect(isEqSolutionsHost('')).toBe(false)
    })
  })

  describe('shellCookieOptions (production)', () => {
    const orig = process.env.NODE_ENV
    afterEach(() => {
      vi.stubEnv('NODE_ENV', orig ?? 'test')
    })

    it('returns SameSite=Lax + Secure under *.eq.solutions', () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(shellCookieOptions('service.eq.solutions')).toEqual({
        sameSite: 'lax',
        secure: true,
      })
    })

    it('falls back to SameSite=None + Secure on netlify.app (cutover window)', () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(shellCookieOptions('eq-solves-service.netlify.app')).toEqual({
        sameSite: 'none',
        secure: true,
      })
    })

    it('returns empty options in dev (browser defaults on localhost)', () => {
      vi.stubEnv('NODE_ENV', 'development')
      expect(shellCookieOptions('localhost')).toEqual({})
    })
  })
})
