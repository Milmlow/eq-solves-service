import type { Role } from '@/lib/types'

const ADMIN_ROLES: Role[] = ['super_admin', 'admin']
const WRITE_ROLES: Role[] = ['super_admin', 'admin', 'supervisor']

export function isAdmin(role: Role | null): boolean {
  return role !== null && ADMIN_ROLES.includes(role)
}

export function canWrite(role: Role | null): boolean {
  return role !== null && WRITE_ROLES.includes(role)
}

export function isSuperAdmin(role: Role | null): boolean {
  return role === 'super_admin'
}
