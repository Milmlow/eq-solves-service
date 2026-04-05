'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { inviteUserAction } from './actions'

export function InviteUserForm() {
  const [error, setError] = useState<string>()
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    setError(undefined); setOk(false)
    startTransition(async () => {
      const res = await inviteUserAction(formData)
      if (res?.error) setError(res.error)
      else if (res?.ok) setOk(true)
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
          defaultValue="user"
          disabled={pending}
          className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send invite'}
      </Button>
      {error && (
        <div className="md:col-span-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      {ok && (
        <div className="md:col-span-4 text-xs text-eq-deep bg-eq-ice border border-eq-sky/30 rounded-md p-3">
          Invite sent. The user will receive an email with a link to set their password.
        </div>
      )}
    </form>
  )
}
