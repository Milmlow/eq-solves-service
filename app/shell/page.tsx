'use client'

// Shell iframe entry point — /shell?#sh=<token>
//
// When Shell embeds Service as an iframe, it navigates to this page with
// the shell token in the URL hash. This page reads the token, calls
// /api/shell-auth to validate it and get a one-time OTP, then uses the
// browser Supabase client to verify the OTP and establish a session.
// On success it navigates directly to /dashboard via window.location.replace
// (not router.replace('/')) to avoid passing through the root page which
// emits a server-side redirect to /dashboard — two redirects instead of one,
// and Next.js router soft-nav stacking has been observed creating redirect
// loops in iframe contexts when the page.tsx redirect fires as an HTTP 3xx.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Status = 'loading' | 'error'

function signalError(code: string) {
  // Tell Shell (the parent frame) that sign-in failed so it can surface a
  // proper error instead of waiting for a 45s load timeout.
  window.parent.postMessage({ type: 'EQ_SERVICE_ERROR', code }, '*')
}

export default function ShellEntryPage() {
  const [status, setStatus] = useState<Status>('loading')
  const [errMsg, setErrMsg] = useState<string>('')

  useEffect(() => {
    const hash = window.location.hash
    const match = hash.match(/[#&]sh=([^&]+)/)
    // Shell encodes the token with encodeURIComponent before placing it in
    // the URL hash. Decode it here — browsers don't auto-decode hash fragments.
    const token = match?.[1] ? decodeURIComponent(match[1]) : undefined

    if (!token) {
      signalError('no-token')
      setStatus('error')
      setErrMsg('No sign-in token found. Navigate here from EQ Shell.')
      return
    }

    async function exchange() {
      try {
        const res = await fetch('/api/shell-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })

        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean   // JWT path — session cookie already set, no OTP needed
          email?: string
          otp?: string
          error?: string
          detail?: string
        }

        if (!res.ok) {
          if (body.error === 'service-account-not-found') {
            signalError('service-account-not-found')
            setStatus('error')
            setErrMsg(
              "Your account isn't set up in EQ Service yet. Ask your admin to provision your access.",
            )
            return
          }
          if (body.error === 'invalid-token') {
            signalError('invalid-token')
            setStatus('error')
            setErrMsg('The sign-in link has expired. Go back to EQ Shell and try again.')
            return
          }
          signalError('auth-failed')
          setStatus('error')
          setErrMsg('Something went wrong signing you in. Please try again.')
          return
        }

        // JWT path: shell-auth set eq_service_jwt cookie server-side, no OTP needed.
        // Navigate directly to /dashboard — skips the root page's redirect() call
        // which can produce HTTP 3xx loops in sandboxed iframe contexts.
        if (body.ok) {
          window.location.replace('/dashboard')
          return
        }

        if (!body.email || !body.otp) {
          signalError('bad-response')
          setStatus('error')
          setErrMsg('Unexpected response from server. Please try again.')
          return
        }

        const supabase = createClient()
        const { error: otpErr } = await supabase.auth.verifyOtp({
          email: body.email,
          token: body.otp,
          type: 'email',
        })

        if (otpErr) {
          signalError('otp-failed')
          setStatus('error')
          setErrMsg('Session setup failed — the sign-in link may have expired. Try again from EQ Shell.')
          return
        }

        // Session established — navigate directly to dashboard (same reasoning as above).
        window.location.replace('/dashboard')
      } catch {
        signalError('network-error')
        setStatus('error')
        setErrMsg('Network error — please check your connection and try again.')
      }
    }

    void exchange()
  }, [])

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  }

  if (status === 'error') {
    return (
      <div style={containerStyle}>
        <div style={{ maxWidth: 360, textAlign: 'center', padding: '0 24px' }}>
          <p style={{ color: 'var(--eq-error-text)', fontWeight: 600, marginBottom: 8 }}>Couldn't sign you in</p>
          <p style={{ color: 'var(--eq-gray-600)', fontSize: 14, lineHeight: 1.5 }}>{errMsg}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <p style={{ color: 'var(--eq-gray-500)', fontSize: 14 }}>Signing you in…</p>
    </div>
  )
}
