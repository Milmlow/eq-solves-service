'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
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

    await logAuditEvent({ action: 'create', entityType: 'customer', summary: `Created customer "${parsed.data.name}"` })
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

    await logAuditEvent({ action: 'update', entityType: 'customer', entityId: id, summary: `Updated customer` })
    revalidatePath('/customers')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importCustomersAction(
  customers: {
    name: string
    code: string | null
    email: string | null
    phone: string | null
    address: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (customers.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (customers.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const rowErrors: string[] = []
    const validRows: typeof customers = []

    for (let i = 0; i < customers.length; i++) {
      const row = customers[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    const insertRows = validRows.map((r) => ({ ...r, tenant_id: tenantId }))
    const { error } = await supabase.from('customers').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'customer', summary: `Imported ${validRows.length} customers from CSV` })
    revalidatePath('/customers')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
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

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'customer', entityId: id, summary: isActive ? 'Reactivated customer' : 'Deactivated customer' })
    revalidatePath('/customers')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
