'use client'

import { useTransition } from 'react'
import { setActiveAction, setRoleAction } from './actions'

interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function UsersTable({
  users,
  currentUserId,
}: {
  users: Profile[]
  currentUserId: string
}) {
  const [pending, startTransition] = useTransition()

  function toggleActive(userId: string, newVal: boolean) {
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('is_active', String(newVal))
    startTransition(() => { setActiveAction(fd) })
  }

  function changeRole(userId: string, newRole: string) {
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('role', newRole)
    startTransition(() => { setRoleAction(fd) })
  }

  return (
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
          return (
            <tr key={u.id} className={u.is_active ? '' : 'bg-gray-50/50'}>
              <td className="px-4 py-3 text-eq-ink font-medium">{u.email}</td>
              <td className="px-4 py-3 text-eq-grey">{u.full_name || '—'}</td>
              <td className="px-4 py-3">
                <select
                  value={u.role}
                  disabled={pending || isSelf}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  className="h-8 px-2 border border-gray-200 rounded text-xs text-eq-ink bg-white disabled:opacity-50"
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="technician">Technician</option>
                  <option value="read_only">Read Only</option>
                </select>
              </td>
              <td className="px-4 py-3">
                <span className={
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ' +
                  (u.is_active
                    ? 'bg-green-50 text-green-700'
                    : 'bg-gray-100 text-gray-500')
                }>
                  {u.is_active ? 'Active' : 'Deactivated'}
                </span>
              </td>
              <td className="px-4 py-3 text-eq-grey text-xs">{fmtDate(u.last_login_at)}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => toggleActive(u.id, !u.is_active)}
                  disabled={pending || isSelf}
                  className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {u.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
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
  )
}
