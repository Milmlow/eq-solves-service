'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'

export async function createCustomerContactAction(customerId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const name = (formData.get('name') as string)?.trim()
    if (!name) return { success: false, error: 'Name is required.' }

    const contactRole = (formData.get('role') as string)?.trim() || null
    const email = (formData.get('email') as string)?.trim() || null
    const phone = (formData.get('phone') as string)?.trim() || null
    const isPrimary = formData.get('is_primary') === 'on'

    // If setting as primary, clear existing primary first
    if (isPrimary) {
      await supabase
        .from('customer_contacts')
        .update({ is_primary: false })
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .eq('is_primary', true)
    }

    const { error } = await supabase
      .from('customer_contacts')
      .insert({ customer_id: customerId, tenant_id: tenantId, name, role: contactRole, email, phone, is_primary: isPrimary })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'customer_contact', summary: `Added contact "${name}" to customer` })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateCustomerContactAction(contactId: string, customerId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const name = (formData.get('name') as string)?.trim()
    if (!name) return { success: false, error: 'Name is required.' }

    const contactRole = (formData.get('role') as string)?.trim() || null
    const email = (formData.get('email') as string)?.trim() || null
    const phone = (formData.get('phone') as string)?.trim() || null
    const isPrimary = formData.get('is_primary') === 'on'

    if (isPrimary) {
      await supabase
        .from('customer_contacts')
        .update({ is_primary: false })
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .eq('is_primary', true)
        .neq('id', contactId)
    }

    const { error } = await supabase
      .from('customer_contacts')
      .update({ name, role: contactRole, email, phone, is_primary: isPrimary })
      .eq('id', contactId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'customer_contact', entityId: contactId, summary: `Updated contact "${name}"` })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteCustomerContactAction(contactId: string, customerId: string) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('customer_contacts')
      .delete()
      .eq('id', contactId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'customer_contact', entityId: contactId, summary: 'Deleted customer contact' })
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
