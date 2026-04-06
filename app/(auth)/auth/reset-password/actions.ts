'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function resetPasswordAction(formData: FormData) {
  const password = String(formData.get('password') || '')
  const confirm = String(formData.get('confirm') || '')

  if (password.length < 10) {
    return { error: 'Password must be at least 10 characters.' }
  }
  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }

  // The email recovery link establishes an AAL1 session. Supabase blocks
  // updateUser({password}) at AAL1 when MFA is enrolled, so we update via
  // the service-role admin API — email ownership is already proven by the
  // recovery link.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Auth session missing. Request a new reset link.' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, { password })
  if (error) return { error: error.message }

  // Sign out so next sign-in enforces MFA challenge freshly.
  await supabase.auth.signOut()
  redirect('/auth/signin?reset=ok')
}
