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

    it('returns false for technician role', () => {
      expect(isAdmin('technician')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(isAdmin(null)).toBe(false)
    })

    it('returns false for read_only role', () => {
      expect(isAdmin('read_only')).toBe(false)
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

    it('returns false for technician role', () => {
      expect(canWrite('technician')).toBe(false)
    })

    it('returns false for read_only role', () => {
      expect(canWrite('read_only')).toBe(false)
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

    it('returns false for technician role', () => {
      expect(isSuperAdmin('technician')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(isSuperAdmin(null)).toBe(false)
    })

    it('returns false for read_only role', () => {
      expect(isSuperAdmin('read_only')).toBe(false)
    })
  })
})
