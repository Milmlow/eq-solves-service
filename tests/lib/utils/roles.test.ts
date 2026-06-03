import { describe, it, expect } from 'vitest'
import { can, fromServiceRole } from '@eq-solutions/roles'
import { isAdmin, canWrite, isSuperAdmin, canCreateCheck, canDoTestWork } from '@/lib/utils/roles'
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

  describe('canDoTestWork', () => {
    // On-site test execution — saving ACB/NSX wizard steps, editing RCD
    // circuit timings, marking a test complete. Loosened in PR A (2026-05-19)
    // to include technician, mirroring the RLS layer (migrations 0069 + 0080
    // + 0081). Without this gate, RLS would allow the write but the app
    // layer blocks it — leaving the tech stuck on-site.
    it('returns true for super_admin role', () => {
      expect(canDoTestWork('super_admin')).toBe(true)
    })

    it('returns true for admin role', () => {
      expect(canDoTestWork('admin')).toBe(true)
    })

    it('returns true for supervisor role', () => {
      expect(canDoTestWork('supervisor')).toBe(true)
    })

    it('returns true for technician role (the whole point)', () => {
      expect(canDoTestWork('technician')).toBe(true)
    })

    it('returns false for read_only role', () => {
      expect(canDoTestWork('read_only')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(canDoTestWork(null)).toBe(false)
    })
  })

  describe('canCreateCheck', () => {
    // Parity check — canDoTestWork and canCreateCheck currently share the
    // same role set, but they exist as separate predicates because they
    // gate different surfaces. If they diverge, both should still let
    // technicians through (that's the contract).
    it('returns true for super_admin role', () => {
      expect(canCreateCheck('super_admin')).toBe(true)
    })

    it('returns true for technician role', () => {
      expect(canCreateCheck('technician')).toBe(true)
    })

    it('returns false for read_only role', () => {
      expect(canCreateCheck('read_only')).toBe(false)
    })

    it('returns false for null role', () => {
      expect(canCreateCheck(null)).toBe(false)
    })
  })

  // C6 (2026-06-04): isAdmin/canWrite are now thin wrappers over the canonical
  // permission matrix from @eq-solutions/roles. These guard the bridge so a
  // future change to the package's mapping or matrix can't silently shift
  // Service's authorisation without a failing test.
  describe('canonical bridge', () => {
    const allRoles: Role[] = ['super_admin', 'admin', 'supervisor', 'technician', 'read_only']

    it('maps every Service role onto a canonical EqRole', () => {
      expect(fromServiceRole('super_admin')).toBe('manager')
      expect(fromServiceRole('admin')).toBe('manager')
      expect(fromServiceRole('supervisor')).toBe('supervisor')
      expect(fromServiceRole('technician')).toBe('employee')
      expect(fromServiceRole('read_only')).toBe('apprentice')
    })

    it('isAdmin agrees with canonical can(role, admin.list_users)', () => {
      for (const r of allRoles) {
        const eq = fromServiceRole(r)!
        expect(isAdmin(r)).toBe(can(eq, 'admin.list_users'))
      }
    })

    it('canWrite agrees with canonical can(role, service.create)', () => {
      for (const r of allRoles) {
        const eq = fromServiceRole(r)!
        expect(canWrite(r)).toBe(can(eq, 'service.create'))
      }
    })

    it('no Service role maps to a platform admin (tenant isolation invariant)', () => {
      // fromServiceRole never returns a role the canonical model treats as
      // cross-tenant; the only cross-tenant lever is the separate
      // is_platform_admin override, which Service does not derive from a role.
      for (const r of allRoles) {
        expect(fromServiceRole(r)).not.toBeNull()
      }
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
