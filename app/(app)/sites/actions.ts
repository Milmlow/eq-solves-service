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

export async function importSitesAction(
  sites: {
    name: string
    code: string | null
    customer_id: string | null
    address: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (sites.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (sites.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const rowErrors: string[] = []
    const validRows: typeof sites = []

    for (let i = 0; i < sites.length; i++) {
      const row = sites[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    const insertRows = validRows.map((r) => ({
      ...r,
      tenant_id: tenantId,
      country: r.country || 'Australia',
    }))
    const { error } = await supabase.from('sites').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'site', summary: `Imported ${validRows.length} sites from CSV` })
    revalidatePath('/sites')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
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
