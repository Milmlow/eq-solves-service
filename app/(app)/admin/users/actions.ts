'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { logAuditEvent } from '@/lib/actions/audit'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()
  if (!profile || !['super_admin', 'admin'].includes(profile.role) || !profile.is_active) {
    throw new Error('Not authorised.')
  }
  return { supabase, user }
}

export async function inviteUserAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const role = String(formData.get('role') || 'user')
  const full_name = String(formData.get('full_name') || '').trim()

  const validRoles = ['super_admin', 'admin', 'supervisor', 'technician', 'read_only']
  if (!email) return { error: 'Email is required.' }
  if (!validRoles.includes(role)) return { error: 'Invalid role.' }

  await requireAdmin()

  const h = await headers()
  const host = h.get('origin') ?? h.get('host') ?? ''
  const origin = host.startsWith('http') ? host : `https://${host}`

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/reset-password`,
    data: { full_name },
  })

  if (error) return { error: error.message }

  // Trigger has already created the profile; set the chosen role.
  if (data.user) {
    await admin
      .from('profiles')
      .update({ role, full_name: full_name || null })
      .eq('id', data.user.id)
  }

  await logAuditEvent({ action: 'create', entityType: 'user', entityId: data.user?.id, summary: `Invited user ${email} with role ${role}` })
  revalidatePath('/admin/users')
  return { ok: true }
}

export async function setActiveAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  const isActive = String(formData.get('is_active') || 'true') === 'true'
  if (!userId) return { error: 'Missing user.' }

  const { user } = await requireAdmin()
  if (userId === user.id && !isActive) {
    return { error: 'You cannot deactivate yourself.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId)
  if (error) return { error: error.message }

  await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'user', entityId: userId, summary: isActive ? 'Reactivated user' : 'Deactivated user' })
  revalidatePath('/admin/users')
  return { ok: true }
}

export async function setRoleAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  const role = String(formData.get('role') || 'user')
  const validRoles = ['super_admin', 'admin', 'supervisor', 'technician', 'read_only']
  if (!userId || !validRoles.includes(role)) {
    return { error: 'Invalid request.' }
  }

  const { user } = await requireAdmin()
  if (userId === user.id && !['super_admin', 'admin'].includes(role)) {
    return { error: 'You cannot demote yourself.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ role }).eq('id', userId)
  if (error) return { error: error.message }

  await logAuditEvent({ action: 'update', entityType: 'user', entityId: userId, summary: `Changed user role to ${role}` })
  revalidatePath('/admin/users')
  return { ok: true }
}
