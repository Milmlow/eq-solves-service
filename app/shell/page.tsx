'use client'

// Shell iframe entry point — /shell?#sh=<token>
//
// When Shell embeds Service as an iframe, it navigates to this page with
// the shell token in the URL hash. This page reads the token, calls
// /api/shell-auth to validate it and get a one-time OTP, then uses the
// browser Supabase client to verify the OTP and establish a session.
// On success it redirects to the main app (/).
//
// This route lives outside the (app) group so it's reachable without
// an existing session — it IS the session bootstrap for iframe users.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Status = 'loading' | 'error'

export default function ShellEntryPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [errMsg, setErrMsg] = useState<string>('')

  useEffect(() => {
    const hash = window.location.hash
    const match = hash.match(/[#&]sh=([^&]+)/)
    const token = match?.[1]

    if (!token) {
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
          email?: string
          otp?: string
          error?: string
          detail?: string
        }

        if (!res.ok) {
          if (body.error === 'service-account-not-found') {
            setStatus('error')
            setErrMsg(
              "Your account isn't set up in EQ Service yet. Ask your admin to provision your access.",
            )
            return
          }
          if (body.error === 'invalid-token') {
            setStatus('error')
            setErrMsg('The sign-in link has expired. Go back to EQ Shell and try again.')
            return
          }
          setStatus('error')
          setErrMsg('Something went wrong signing you in. Please try again.')
          return
        }

        if (!body.email || !body.otp) {
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
          setStatus('error')
          setErrMsg('Session setup failed — the sign-in link may have expired. Try again from EQ Shell.')
          return
        }

        // Session established — redirect to the main app.
        router.replace('/')
      } catch {
        setStatus('error')
        setErrMsg('Network error — please check your connection and try again.')
      }
    }

    void exchange()
  }, [router])

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
