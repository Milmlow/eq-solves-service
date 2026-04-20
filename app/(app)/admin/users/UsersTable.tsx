'use client'

import { useState, useTransition } from 'react'
import {
  setActiveAction,
  setRoleAction,
  removeUserFromTenantAction,
  resendInviteAction,
  repairUserTenantAction,
} from './actions'

interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string
  is_active: boolean
  last_login_at: string | null
  created_at: string
  has_tenant_membership: boolean
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  // Pin timeZone so server (UTC) and client (AEST) render the same string.
  // Without this, `last_login_at` values near midnight UTC trigger React
  // hydration error #418 because the server renders one day and the browser
  // another.
  return new Date(s).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Australia/Sydney',
  })
}

export function UsersTable({
  users,
  currentUserId,
}: {
  users: Profile[]
  currentUserId: string
}) {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function show(kind: 'ok' | 'err', text: string) {
    setNotice({ kind, text })
  }

  function toggleActive(userId: string, newVal: boolean) {
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('is_active', String(newVal))
    setNotice(null)
    startTransition(async () => {
      const res = await setActiveAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
    })
  }

  function changeRole(userId: string, newRole: string) {
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('role', newRole)
    setNotice(null)
    startTransition(async () => {
      const res = await setRoleAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
    })
  }

  function removeFromTenant(userId: string, label: string) {
    if (!confirm(`Remove ${label} from this tenant? Their account will remain but they'll lose access. You can re-invite them later.`)) return
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    startTransition(async () => {
      const res = await removeUserFromTenantAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
    })
  }

  function resendInvite(userId: string, label: string) {
    if (!confirm(`Resend invite email to ${label}?`)) return
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    startTransition(async () => {
      const res = await resendInviteAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
      else show('ok', 'Invite resent.')
    })
  }

  function repairUser(userId: string, label: string, role: string) {
    if (!confirm(`Attach ${label} to this tenant as ${role}?`)) return
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('role', role || 'technician')
    startTransition(async () => {
      const res = await repairUserTenantAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
      else show('ok', 'User attached to this tenant.')
    })
  }

  return (
    <>
      {notice && (
        <div
          className={
            'px-4 py-2 border-b text-xs ' +
            (notice.kind === 'ok'
              ? 'bg-eq-ice border-eq-sky/30 text-eq-deep'
              : 'bg-red-50 border-red-100 text-red-700')
          }
        >
          {notice.text}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-bold text-eq-grey uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">Role</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Last login</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map((u) => {
            const isSelf = u.id === currentUserId
            const noTenant = !u.has_tenant_membership
            return (
              <tr key={u.id} className={u.is_active ? '' : 'bg-gray-50/50'}>
                <td className="px-4 py-3 text-eq-ink font-medium">{u.email}</td>
                <td className="px-4 py-3 text-eq-grey">{u.full_name || '—'}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    disabled={pending || isSelf || noTenant}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                    className="h-8 px-2 border border-gray-200 rounded text-xs text-eq-ink bg-white disabled:opacity-50"
                    title={noTenant ? 'Attach this user to the tenant first' : undefined}
                  >
                    <option value="super_admin">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="technician">Technician</option>
                    <option value="read_only">Read Only</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {noTenant ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-amber-50 text-amber-700">
                      No tenant
                    </span>
                  ) : (
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ' +
                        (u.is_active
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500')
                      }
                    >
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-eq-grey text-xs">{fmtDate(u.last_login_at)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {noTenant && (
                      <button
                        type="button"
                        onClick={() => repairUser(u.id, u.full_name || u.email, u.role)}
                        disabled={pending}
                        className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                        title="Attach this user to the current tenant"
                      >
                        Attach
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => resendInvite(u.id, u.full_name || u.email)}
                      disabled={pending}
                      className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      title="Resend the invite / password reset email"
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(u.id, !u.is_active)}
                      disabled={pending || isSelf}
                      className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      title={u.is_active
                        ? 'Disable sign-in across ALL tenants — different from Remove (current tenant only)'
                        : 'Re-enable sign-in across all tenants'}
                    >
                      {u.is_active ? 'Disable account' : 'Enable account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromTenant(u.id, u.full_name || u.email)}
                      disabled={pending || isSelf || noTenant}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      title="Remove this user from the current tenant (reversible)"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-eq-grey text-sm">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
