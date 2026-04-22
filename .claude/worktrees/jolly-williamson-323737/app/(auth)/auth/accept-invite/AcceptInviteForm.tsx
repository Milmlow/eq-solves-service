'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { createClient } from '@/lib/supabase/client'
import { acceptInviteAction } from './actions'

interface Props {
  email: string
  initialName: string
}

/**
 * Client portion of the invite-acceptance flow. Handles the two ways Supabase
 * can land a user here (PKCE cookie already set by /auth/callback, or implicit
 * flow tokens in the URL hash — same pattern as reset-password), and renders
 * a password-strength indicator so the user gets live feedback instead of a
 * mystery "too short" error on submit.
 */
export function AcceptInviteForm({ email, initialName }: Props) {
  const [error, setError] = useState<string>()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, startTransition] = useTransition()
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function bootstrapSession() {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        if (!cancelled) setSessionReady(true)
        return
      }

      if (typeof window !== 'undefined' && window.location.hash) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!setErr) {
            window.history.replaceState(null, '', window.location.pathname)
            if (!cancelled) setSessionReady(true)
            return
          }
        }
      }

      if (!cancelled) {
        setSessionReady(false)
        setError(
          'This invite link has expired or been used already. Ask your administrator to send a new one.'
        )
      }
    }

    void bootstrapSession()
    return () => {
      cancelled = true
    }
  }, [])

  const strength = scorePassword(password)
  const mismatch = confirm.length > 0 && confirm !== password

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await acceptInviteAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <FormInput
        label="Email"
        name="email_display"
        value={email}
        readOnly
        disabled
        className="bg-eq-ice/40 text-eq-grey cursor-not-allowed"
      />

      <FormInput
        label="Full name"
        name="full_name"
        defaultValue={initialName}
        required
        autoComplete="name"
        placeholder="Jane Smith"
        disabled={pending || !sessionReady}
      />

      <div>
        <FormInput
          label="Create a password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="At least 10 characters"
          disabled={pending || !sessionReady}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <StrengthMeter score={strength} show={password.length > 0} />
      </div>

      <FormInput
        label="Confirm password"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        disabled={pending || !sessionReady}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? 'Passwords do not match' : undefined}
      />

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3 leading-relaxed">
          {error}
        </div>
      )}

      <Button
        type="submit"
        disabled={pending || !sessionReady || mismatch || strength < 2}
        className="mt-1"
      >
        {pending ? 'Creating your account…' : 'Create my account'}
      </Button>
    </form>
  )
}

/**
 * Basic heuristic password score 0–4. Not security-critical (Supabase enforces
 * its own minimum on the server); this is purely UX feedback so users learn
 * what "strong" looks like rather than guessing.
 */
function scorePassword(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 10) score++
  if (pw.length >= 14) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

function StrengthMeter({ score, show }: { score: number; show: boolean }) {
  if (!show) return null
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
  const colours = ['bg-red-300', 'bg-red-400', 'bg-yellow-400', 'bg-eq-sky', 'bg-eq-deep']
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex-1 grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 rounded ${i <= score ? colours[score] : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <span className="text-[11px] text-eq-grey font-medium w-16 text-right">
        {labels[score]}
      </span>
    </div>
  )
}
