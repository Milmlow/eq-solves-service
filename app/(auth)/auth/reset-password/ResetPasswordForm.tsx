'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { resetPasswordAction } from './actions'

export function ResetPasswordForm() {
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await resetPasswordAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <FormInput
        label="New password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        disabled={pending}
      />
      <FormInput
        label="Confirm password"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        disabled={pending}
      />
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  )
}
