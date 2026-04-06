'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { signInAction } from './actions'

export function SignInForm({
  next,
  initialError,
}: {
  next: string
  initialError?: string
}) {
  const [error, setError] = useState<string | undefined>(initialError)
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await signInAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <FormInput
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        disabled={pending}
      />
      <FormInput
        label="Password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        disabled={pending}
      />
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
