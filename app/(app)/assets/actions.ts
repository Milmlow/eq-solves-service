'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { CreateAssetSchema, UpdateAssetSchema } from '@/lib/validations/asset'

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
    }

    const parsed = CreateAssetSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('assets')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

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
    }

    const parsed = UpdateAssetSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('assets')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/assets')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
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

    revalidatePath('/assets')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
