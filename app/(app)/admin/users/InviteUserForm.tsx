'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { inviteUserAction } from './actions'

export function InviteUserForm() {
  const [error, setError] = useState<string>()
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()

  const [okEmail, setOkEmail] = useState<string>()

  function onSubmit(formData: FormData) {
    setError(undefined); setOk(false); setOkEmail(undefined)
    startTransition(async () => {
      const res = await inviteUserAction(formData)
      if ('error' in res && res.error) setError(res.error)
      else if ('ok' in res && res.ok) { setOk(true); setOkEmail(res.email) }
    })
  }

  return (
    <form action={onSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
      <FormInput label="Email" name="email" type="email" required disabled={pending} />
      <FormInput label="Full name" name="full_name" disabled={pending} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Role</label>
        <select
          name="role"
          defaultValue="technician"
          disabled={pending}
          className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        >
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="supervisor">Supervisor</option>
          <option value="technician">Technician</option>
          <option value="read_only">Read Only</option>
        </select>
      </div>
      <Button type="submit" loading={pending}>
        Send invite
      </Button>
      {error && (
        <div className="md:col-span-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      {ok && (
        <div className="md:col-span-4 text-xs text-eq-deep bg-eq-ice border border-eq-sky/30 rounded-md p-3">
          Invite sent to <strong>{okEmail}</strong>. They&apos;ll receive an email with a link to set their password.
          If they don&apos;t see it, use the Resend action in the table below.
        </div>
      )}
    </form>
  )
}
