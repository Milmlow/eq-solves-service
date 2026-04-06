'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { CreateCustomerSchema, UpdateCustomerSchema } from '@/lib/validations/customer'

export async function createCustomerAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      code: formData.get('code') || null,
      email: formData.get('email') || null,
      phone: formData.get('phone') || null,
      address: formData.get('address') || null,
    }

    const parsed = CreateCustomerSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('customers')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    revalidatePath('/customers')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateCustomerAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      name: formData.get('name'),
      code: formData.get('code') || null,
      email: formData.get('email') || null,
      phone: formData.get('phone') || null,
      address: formData.get('address') || null,
    }

    const parsed = UpdateCustomerSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('customers')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/customers')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleCustomerActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('customers')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/customers')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
