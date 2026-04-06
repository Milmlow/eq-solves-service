'use server'

import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

export async function forgotPasswordAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim()
  if (!email) return { error: 'Email is required.' }

  const supabase = await createClient()
  const h = await headers()
  const host = h.get('origin') ?? h.get('host') ?? ''
  const origin = host.startsWith('http') ? host : `https://${host}`

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  })

  if (error) return { error: error.message }
  return { ok: true }
}
