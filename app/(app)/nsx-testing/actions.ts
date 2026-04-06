'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { CreateNsxTestSchema, UpdateNsxTestSchema, CreateNsxReadingSchema } from '@/lib/validations/nsx-test'

export async function createNsxTestAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      asset_id: formData.get('asset_id'),
      site_id: formData.get('site_id'),
      test_date: formData.get('test_date'),
      tested_by: formData.get('tested_by') || null,
      test_type: formData.get('test_type') || 'Routine',
      cb_make: formData.get('cb_make') || null,
      cb_model: formData.get('cb_model') || null,
      cb_serial: formData.get('cb_serial') || null,
      cb_rating: formData.get('cb_rating') || null,
      cb_poles: formData.get('cb_poles') || null,
      trip_unit: formData.get('trip_unit') || null,
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = CreateNsxTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('nsx_tests')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'nsx_test', summary: 'Created NSX test record' })
    revalidatePath('/nsx-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateNsxTestAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      asset_id: formData.get('asset_id'),
      site_id: formData.get('site_id'),
      test_date: formData.get('test_date'),
      tested_by: formData.get('tested_by') || null,
      test_type: formData.get('test_type') || 'Routine',
      cb_make: formData.get('cb_make') || null,
      cb_model: formData.get('cb_model') || null,
      cb_serial: formData.get('cb_serial') || null,
      cb_rating: formData.get('cb_rating') || null,
      cb_poles: formData.get('cb_poles') || null,
      trip_unit: formData.get('trip_unit') || null,
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateNsxTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('nsx_tests')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'nsx_test', entityId: id, summary: 'Updated NSX test record' })
    revalidatePath('/nsx-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleNsxTestActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const { error } = await supabase
      .from('nsx_tests')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'nsx_test', entityId: id, summary: isActive ? 'Reactivated NSX test' : 'Deactivated NSX test' })
    revalidatePath('/nsx-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function createNsxReadingAction(nsxTestId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      label: formData.get('label'),
      value: formData.get('value'),
      unit: formData.get('unit') || null,
      is_pass: formData.get('is_pass') === 'true' ? true : formData.get('is_pass') === 'false' ? false : null,
      sort_order: Number(formData.get('sort_order') ?? 0),
    }

    const parsed = CreateNsxReadingSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('nsx_test_readings')
      .insert({ ...parsed.data, nsx_test_id: nsxTestId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'nsx_test_reading', summary: 'Added NSX test reading' })
    revalidatePath('/nsx-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteNsxReadingAction(readingId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('nsx_test_readings')
      .delete()
      .eq('id', readingId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'nsx_test_reading', entityId: readingId, summary: 'Deleted NSX test reading' })
    revalidatePath('/nsx-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
