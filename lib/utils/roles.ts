import type { Role } from '@/lib/types'

const ADMIN_ROLES: Role[] = ['super_admin', 'admin']
const WRITE_ROLES: Role[] = ['super_admin', 'admin', 'supervisor']
const CHECK_CREATOR_ROLES: Role[] = ['super_admin', 'admin', 'supervisor', 'technician']

export function isAdmin(role: Role | null): boolean {
  return role !== null && ADMIN_ROLES.includes(role)
}

export function canWrite(role: Role | null): boolean {
  return role !== null && WRITE_ROLES.includes(role)
}

// Narrow allowance for spinning up a maintenance_check on-site. Mirrors the
// RLS policy "Writers can create checks" from migration 0080, which includes
// technician — broader than canWrite() so a tech can start an ad-hoc check
// without flagging down a supervisor. Use this ONLY for the check-creation
// path; other mutations should keep using canWrite().
export function canCreateCheck(role: Role | null): boolean {
  return role !== null && CHECK_CREATOR_ROLES.includes(role)
}

export function isSuperAdmin(role: Role | null): boolean {
  return role === 'super_admin'
}
