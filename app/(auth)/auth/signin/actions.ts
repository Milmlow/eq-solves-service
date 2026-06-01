'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/utils/demo'

const ALLOWED_ORIGINS = [
  'https://core.eq.solutions',
  'https://service.eq.solutions',
  'https://eq-solves-service.netlify.app',
]

/**
 * Validate the post-sign-in redirect destination.
 *
 * Safe values:
 *   - Relative paths starting with / (but not //, which is protocol-relative)
 *   - Absolute HTTPS URLs whose origin is in ALLOWED_ORIGINS
 *
 * Everything else falls back to / to prevent open-redirect attacks.
 */
function safeNext(raw: string): string {
  const trimmed = raw.trim()
  // Relative path — safe as long as it's not protocol-relative (//).
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  // Absolute URL — only allow known origins.
  try {
    const parsed = new URL(trimmed)
    if (ALLOWED_ORIGINS.includes(parsed.origin)) return trimmed
  } catch {
    // Not a valid URL — fall through.
  }
  return '/'
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')
  const next = safeNext(String(formData.get('next') || ''))

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { error: error.message }
  }

  // Update last_login_at
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)
  }

  // proxy.ts will redirect to /auth/mfa or /auth/enroll-mfa as needed.
  redirect(next)
}

/**
 * One-click demo sign-in. Uses the public demo fixture credentials
 * (see lib/utils/demo.ts). Called from the "Try the demo" button on
 * the signin page and the shareable /demo route.
 */
export async function startDemoSessionAction() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  })
  if (error) {
    return { error: `Demo sign-in failed: ${error.message}` }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)
  }

  redirect('/dashboard')
}
