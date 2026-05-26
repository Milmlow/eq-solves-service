'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { CreateAssetSchema, UpdateAssetSchema } from '@/lib/validations/asset'
import { zodToErrorMap } from '@/lib/utils/zodErrors'
import { logAuditEvent } from '@/lib/actions/audit'

export async function createAssetAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id'),
      name: formData.get('name'),
      asset_type: formData.get('asset_type'),
      manufacturer: formData.get('manufacturer') || null,
      model: formData.get('model') || null,
      serial_number: formData.get('serial_number') || null,
      maximo_id: formData.get('maximo_id') || null,
      install_date: formData.get('install_date') || null,
      location: formData.get('location') || null,
      job_plan_id: formData.get('job_plan_id') || null,
      dark_site_test: formData.get('dark_site_test') === 'on',
    }

    const parsed = CreateAssetSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    const { error } = await supabase
      .from('assets')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'asset', summary: `Created asset "${parsed.data.name}"` })
    revalidatePath('/assets')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateAssetAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id'),
      name: formData.get('name'),
      asset_type: formData.get('asset_type'),
      manufacturer: formData.get('manufacturer') || null,
      model: formData.get('model') || null,
      serial_number: formData.get('serial_number') || null,
      maximo_id: formData.get('maximo_id') || null,
      install_date: formData.get('install_date') || null,
      location: formData.get('location') || null,
      job_plan_id: formData.get('job_plan_id') || null,
      dark_site_test: formData.get('dark_site_test') === 'on',
    }

    const parsed = UpdateAssetSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, errors: zodToErrorMap(parsed.error.issues) }

    const { error } = await supabase
      .from('assets')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'asset', entityId: id, summary: 'Updated asset' })
    revalidatePath('/assets')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importAssetsAction(
  assets: {
    name: string
    asset_type: string
    site_id: string
    manufacturer: string | null
    model: string | null
    serial_number: string | null
    maximo_id: string | null
    location: string | null
    install_date: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (assets.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (assets.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const rowErrors: string[] = []
    const validRows: typeof assets = []

    for (let i = 0; i < assets.length; i++) {
      const row = assets[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      if (!row.asset_type?.trim()) { rowErrors.push(`Row ${i + 1}: Asset type is required.`); continue }
      if (!row.site_id) { rowErrors.push(`Row ${i + 1}: Invalid or unknown site.`); continue }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    // Batch insert with tenant_id
    const insertRows = validRows.map((r) => ({ ...r, tenant_id: tenantId }))
    const { error } = await supabase.from('assets').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'asset', summary: `Imported ${validRows.length} assets from CSV` })
    revalidatePath('/assets')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
  }
}

export async function toggleAssetActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('assets')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'asset', entityId: id, summary: isActive ? 'Reactivated asset' : 'Deactivated asset' })
    revalidatePath('/assets')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Bulk-rename assets by ID. Used by the Maximo import review step when the
 * user chooses to adopt Maximo names over the existing EQ Service names.
 * Each update is a minimal patch — only `name` is touched.
 */
export async function bulkUpdateAssetNamesAction(
  updates: Array<{ id: string; name: string }>
): Promise<{ success: boolean; error?: string; updated: number }> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.', updated: 0 }
    if (updates.length === 0) return { success: true, updated: 0 }

    let updated = 0
    let firstDbError: string | undefined
    for (const { id, name } of updates) {
      const trimmed = name.trim()
      if (!trimmed) continue
      const { error } = await supabase
        .from('assets')
        .update({ name: trimmed })
        .eq('id', id)
        // Belt-and-suspenders: RLS already scopes to tenant, but explicit
        // tenant_id check ensures a stale/wrong id can never touch another
        // tenant's assets even if RLS policy is mis-configured.
        .eq('tenant_id', tenantId)
      if (error) firstDbError = firstDbError ?? error.message
      else updated++
    }

    // Surface failure if nothing was written — the caller (modal) checks
    // success and blocks confirm if this returns false.
    const attempted = updates.filter(u => u.name.trim()).length
    if (updated === 0 && attempted > 0) {
      return { success: false, error: firstDbError ?? 'No assets were updated.', updated: 0 }
    }

    revalidatePath('/assets')
    return { success: true, updated }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, updated: 0 }
  }
}
