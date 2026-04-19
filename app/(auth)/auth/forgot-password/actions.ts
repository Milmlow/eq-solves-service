'use server'

import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { getSiteUrl } from '@/lib/utils/site-url'

export async function forgotPasswordAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim()
  if (!email) return { error: 'Email is required.' }

  const supabase = await createClient()
  const h = await headers()
  // Prefer the env-configured site URL so reset emails sent from a local dev
  // build still point at the production origin in production environments.
  const origin = getSiteUrl(h.get('origin') ?? h.get('host'))

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  })

  if (error) return { error: error.message }
  return { ok: true }
}
