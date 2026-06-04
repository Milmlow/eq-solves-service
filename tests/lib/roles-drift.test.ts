import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  SERVICE_ROLE_MAP,
  fromServiceRole,
  isEqRole,
  ROLE_KEYS,
  type EqRole,
} from '@eq-solutions/roles'
import { EQ_TO_SERVICE_ROLE } from '@/lib/utils/roles'
import { SERVICE_ROLES, type Role } from '@/lib/types'

// ── C6 drift guard ─────────────────────────────────────────────────────
//
// The Service role vocabulary lives in three places that MUST agree:
//   1. the `Role` union / `SERVICE_ROLES` runtime list (lib/types),
//   2. the `tenant_members.role` DB CHECK constraint (migration 0002),
//   3. the canonical `SERVICE_ROLE_MAP` keys in @eq-solutions/roles.
// If any of these silently diverges, the canonical adapter (`fromServiceRole`)
// starts returning null for a real role — or a real role stops being a valid
// DB value. These tests fail loudly the moment they drift apart.

const sorted = (xs: readonly string[]) => [...xs].sort()

/** All `role IN (...)` literal sets declared in migration 0002. */
function roleCheckSetsFromMigration(): string[][] {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/0002_core_schema.sql'),
    'utf8',
  )
  const sets: string[][] = []
  const re = /role IN \(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const roles = m[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    sets.push(roles)
  }
  return sets
}

describe('C6 role-vocabulary drift guard', () => {
  it('SERVICE_ROLE_MAP keys equal the Service Role union (SERVICE_ROLES)', () => {
    expect(sorted(Object.keys(SERVICE_ROLE_MAP))).toEqual(sorted(SERVICE_ROLES))
  })

  it('SERVICE_ROLES matches the tenant_members.role DB CHECK constraint (migration 0002)', () => {
    const sets = roleCheckSetsFromMigration()
    expect(sets.length).toBeGreaterThan(0)
    // The tenant_members CHECK is exactly the 5 Service roles (the profiles
    // CHECK additionally allows 'user', so it won't match).
    const match = sets.find(
      (s) => JSON.stringify(sorted(s)) === JSON.stringify(sorted(SERVICE_ROLES)),
    )
    expect(
      match,
      `No role CHECK in 0002 matches SERVICE_ROLES. Found: ${JSON.stringify(sets)}`,
    ).toBeDefined()
  })

  it('every Service role resolves to a valid canonical EqRole', () => {
    for (const r of SERVICE_ROLES) {
      const eq = fromServiceRole(r)
      expect(eq, `fromServiceRole(${r}) returned null`).not.toBeNull()
      expect(isEqRole(eq)).toBe(true)
    }
  })

  it('SERVICE_ROLE_MAP matches the documented C6 mapping exactly', () => {
    const expected: Record<Role, EqRole> = {
      super_admin: 'manager',
      admin: 'manager',
      supervisor: 'supervisor',
      technician: 'employee',
      read_only: 'apprentice',
    }
    expect(SERVICE_ROLE_MAP).toEqual(expected)
  })

  it('tenant-isolation invariant: super_admin is a tenant-scoped manager, never platform admin', () => {
    // The forward adapter only ever yields a tenant-scoped EqRole — there is
    // no path from a Service role to is_platform_admin. super_admin maps to
    // `manager`, the same as admin (the deliberate C6 collapse).
    expect(SERVICE_ROLE_MAP.super_admin).toBe('manager')
    expect(SERVICE_ROLE_MAP.admin).toBe('manager')
  })

  it('fromServiceRole returns null for unknown input', () => {
    expect(fromServiceRole('platform_admin')).toBeNull()
    expect(fromServiceRole('')).toBeNull()
    expect(fromServiceRole('manager')).toBeNull() // canonical role is not a Service role
  })

  it('inverse map (EQ_TO_SERVICE_ROLE) covers every EqRole and emits valid Service roles', () => {
    expect(sorted(Object.keys(EQ_TO_SERVICE_ROLE))).toEqual(sorted(ROLE_KEYS))
    for (const v of Object.values(EQ_TO_SERVICE_ROLE)) {
      expect(SERVICE_ROLES).toContain(v)
    }
  })
})
