'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'

export async function updateProfileAction(formData: FormData) {
  try {
    const { supabase, user } = await requireUser()

    const fullName = (formData.get('full_name') as string)?.trim() || null

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', user.id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'profile', entityId: user.id, summary: 'Updated profile name' })
    revalidatePath('/settings')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function changePasswordAction(formData: FormData) {
  try {
    const { supabase } = await requireUser()

    const newPassword = formData.get('new_password') as string
    const confirmPassword = formData.get('confirm_password') as string

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' }
    }
    if (newPassword !== confirmPassword) {
      return { success: false, error: 'Passwords do not match.' }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'profile', summary: 'Changed password' })
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
