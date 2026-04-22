'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { forgotPasswordAction } from './actions'

export function ForgotPasswordForm() {
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await forgotPasswordAction(formData)
      if (res?.error) setError(res.error)
      else if (res?.ok) setSent(true)
    })
  }

  if (sent) {
    return (
      <div className="text-sm text-eq-ink bg-eq-ice border border-eq-sky/30 rounded-md p-4">
        If an account exists for that email, a reset link has been sent. Check your inbox.
      </div>
    )
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <FormInput
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        disabled={pending}
      />
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  )
}
