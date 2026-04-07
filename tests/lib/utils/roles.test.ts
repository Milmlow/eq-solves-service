import { describe, it, expect } from 'vitest'
import { isAdmin, canWrite, isSuperAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

describe('Role Utilities', () => {
  describe('isAdmin', () => {
    it('returns true for super_admin role', () => {
      expect(isAdmin('super_admin')).toBe(true)
    })

    it('returns true for admin role', () => {
      expect(isAdmin('admin')).toBe(true)
    })

    it('returns false for supervisor role', () => {
      expect(isAdmin('supervisor')).toBe(false)
    })

    it('returns false for analyst role', () => {
      expect(isAdmin('analyst')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(isAdmin(null)).toBe(false)
    })

    it('returns false for viewer role', () => {
      expect(isAdmin('viewer')).toBe(false)
    })
  })

  describe('canWrite', () => {
    it('returns true for super_admin role', () => {
      expect(canWrite('super_admin')).toBe(true)
    })

    it('returns true for admin role', () => {
      expect(canWrite('admin')).toBe(true)
    })

    it('returns true for supervisor role', () => {
      expect(canWrite('supervisor')).toBe(true)
    })

    it('returns false for analyst role', () => {
      expect(canWrite('analyst')).toBe(false)
    })

    it('returns false for viewer role', () => {
      expect(canWrite('viewer')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(canWrite(null)).toBe(false)
    })
  })

  describe('isSuperAdmin', () => {
    it('returns true for super_admin role', () => {
      expect(isSuperAdmin('super_admin')).toBe(true)
    })

    it('returns false for admin role', () => {
      expect(isSuperAdmin('admin')).toBe(false)
    })

    it('returns false for supervisor role', () => {
      expect(isSuperAdmin('supervisor')).toBe(false)
    })

    it('returns false for analyst role', () => {
      expect(isSuperAdmin('analyst')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(isSuperAdmin(null)).toBe(false)
    })

    it('returns false for viewer role', () => {
      expect(isSuperAdmin('viewer')).toBe(false)
    })
  })
})
