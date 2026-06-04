import { describe, it, expect } from 'vitest'
import { can } from '@eq-solutions/roles'
import { isAdmin, canWrite, canCreateCheck, canDoTestWork } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

// Service stores canonical EQ roles directly (migration 0114). These helpers
// are thin wrappers over the canonical permission matrix from
// @eq-solutions/roles. There is no cross-tenant / super-admin predicate —
// platform power is out-of-band, never a tenant role.

const ALL_ROLES: Role[] = ['manager', 'supervisor', 'employee', 'apprentice', 'labour_hire']

describe('Role Utilities (canonical)', () => {
  describe('isAdmin — manager only', () => {
    it('true for manager', () => expect(isAdmin('manager')).toBe(true))
    it('false for supervisor', () => expect(isAdmin('supervisor')).toBe(false))
    it('false for employee', () => expect(isAdmin('employee')).toBe(false))
    it('false for apprentice', () => expect(isAdmin('apprentice')).toBe(false))
    it('false for labour_hire', () => expect(isAdmin('labour_hire')).toBe(false))
    it('false for null', () => expect(isAdmin(null)).toBe(false))
  })

  describe('canWrite — manager + supervisor', () => {
    it('true for manager', () => expect(canWrite('manager')).toBe(true))
    it('true for supervisor', () => expect(canWrite('supervisor')).toBe(true))
    it('false for employee', () => expect(canWrite('employee')).toBe(false))
    it('false for apprentice', () => expect(canWrite('apprentice')).toBe(false))
    it('false for labour_hire', () => expect(canWrite('labour_hire')).toBe(false))
    it('false for null', () => expect(canWrite(null)).toBe(false))
  })

  describe('canCreateCheck / canDoTestWork — manager + supervisor + employee', () => {
    it('true for manager', () => {
      expect(canCreateCheck('manager')).toBe(true)
      expect(canDoTestWork('manager')).toBe(true)
    })
    it('true for supervisor', () => {
      expect(canCreateCheck('supervisor')).toBe(true)
      expect(canDoTestWork('supervisor')).toBe(true)
    })
    it('true for employee (the on-site point)', () => {
      expect(canCreateCheck('employee')).toBe(true)
      expect(canDoTestWork('employee')).toBe(true)
    })
    it('false for apprentice', () => {
      expect(canCreateCheck('apprentice')).toBe(false)
      expect(canDoTestWork('apprentice')).toBe(false)
    })
    it('false for labour_hire', () => {
      expect(canCreateCheck('labour_hire')).toBe(false)
      expect(canDoTestWork('labour_hire')).toBe(false)
    })
    it('false for null', () => {
      expect(canCreateCheck(null)).toBe(false)
      expect(canDoTestWork(null)).toBe(false)
    })
  })

  // Guard the bridge: a future change to the canonical matrix can't silently
  // shift Service's authorisation without a failing test.
  describe('canonical matrix agreement', () => {
    it('isAdmin agrees with can(role, admin.list_users)', () => {
      for (const r of ALL_ROLES) expect(isAdmin(r)).toBe(can(r, 'admin.list_users'))
    })
    it('canWrite agrees with can(role, service.create)', () => {
      for (const r of ALL_ROLES) expect(canWrite(r)).toBe(can(r, 'service.create'))
    })
  })
})
