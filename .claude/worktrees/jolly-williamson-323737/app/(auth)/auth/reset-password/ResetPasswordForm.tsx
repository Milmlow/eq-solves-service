'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { createClient } from '@/lib/supabase/client'
import { resetPasswordAction } from './actions'

/**
 * Handles the two ways Supabase can deliver a reset/invite session:
 *
 *   1. PKCE flow: callback at /auth/callback exchanged `?code=` for a session
 *      cookie already. Nothing to do on this page.
 *
 *   2. Implicit flow: Supabase redirects to this page with tokens in the URL
 *      hash: `#access_token=...&refresh_token=...&type=recovery`.
 *      We parse those and call setSession() to persist a session cookie
 *      client-side before the user submits the form.
 *
 * Either way, the server action then sees a valid user.
 */
export function ResetPasswordForm() {
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function bootstrapSession() {
      // Case 1 — server already set the cookie via /auth/callback.
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        if (!cancelled) setSessionReady(true)
        return
      }

      // Case 2 — implicit flow hash fragment.
      if (typeof window !== 'undefined' && window.location.hash) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!setErr) {
            // Remove tokens from the URL so a refresh doesn't replay them.
            window.history.replaceState(null, '', window.location.pathname)
            if (!cancelled) setSessionReady(true)
            return
          }
        }
      }

      if (!cancelled) {
        setSessionReady(false)
        setError(
          'Auth session missing. Request a new reset link from the sign-in page.'
        )
      }
    }

    void bootstrapSession()
    return () => { cancelled = true }
  }, [])

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
        disabled={pending || !sessionReady}
      />
      <FormInput
        label="Confirm password"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        disabled={pending || !sessionReady}
      />
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending || !sessionReady}>
        {pending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  )
}
