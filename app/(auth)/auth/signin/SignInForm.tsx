'use client'

import { useState, useTransition } from 'react'
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
    <form action={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="email" className="block text-xs font-medium text-eq-ink mb-1.5">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          disabled={pending}
          placeholder="you@company.com"
          className="w-full px-3.5 py-2.5 text-sm text-eq-ink bg-gray-50 border border-gray-200 rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky/40 focus:border-eq-sky focus:bg-white transition-all disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-medium text-eq-ink mb-1.5">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          disabled={pending}
          placeholder="••••••••"
          className="w-full px-3.5 py-2.5 text-sm text-eq-ink bg-gray-50 border border-gray-200 rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky/40 focus:border-eq-sky focus:bg-white transition-all disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-eq-sky rounded-lg hover:bg-eq-deep focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Signing in…
          </span>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  )
}
