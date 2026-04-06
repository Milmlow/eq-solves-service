'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import { CreateSiteSchema, UpdateSiteSchema } from '@/lib/validations/site'

export async function createSiteAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      code: formData.get('code') || null,
      customer_id: formData.get('customer_id') || null,
      address: formData.get('address') || null,
      city: formData.get('city') || null,
      state: formData.get('state') || null,
      postcode: formData.get('postcode') || null,
      country: formData.get('country') || 'Australia',
    }

    const parsed = CreateSiteSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('sites')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'site', summary: `Created site "${parsed.data.name}"` })
    revalidatePath('/sites')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateSiteAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      code: formData.get('code') || null,
      customer_id: formData.get('customer_id') || null,
      address: formData.get('address') || null,
      city: formData.get('city') || null,
      state: formData.get('state') || null,
      postcode: formData.get('postcode') || null,
      country: formData.get('country') || 'Australia',
    }

    const parsed = UpdateSiteSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('sites')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'site', entityId: id, summary: 'Updated site' })
    revalidatePath('/sites')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleSiteActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('sites')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'site', entityId: id, summary: isActive ? 'Reactivated site' : 'Deactivated site' })
    revalidatePath('/sites')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
