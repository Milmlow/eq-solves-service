'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { CreateAcbTestSchema, UpdateAcbTestSchema, CreateAcbReadingSchema } from '@/lib/validations/acb-test'

export async function createAcbTestAction(formData: FormData) {
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
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = CreateAcbTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('acb_tests')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'acb_test', summary: 'Created ACB test record' })
    revalidatePath('/acb-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateAcbTestAction(id: string, formData: FormData) {
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
      overall_result: formData.get('overall_result') || 'Pending',
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateAcbTestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('acb_tests')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: id, summary: 'Updated ACB test record' })
    revalidatePath('/acb-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function toggleAcbTestActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const { error } = await supabase
      .from('acb_tests')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'acb_test', entityId: id, summary: isActive ? 'Reactivated ACB test' : 'Deactivated ACB test' })
    revalidatePath('/acb-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function createAcbReadingAction(acbTestId: string, formData: FormData) {
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

    const parsed = CreateAcbReadingSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('acb_test_readings')
      .insert({ ...parsed.data, acb_test_id: acbTestId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'acb_test_reading', summary: 'Added ACB test reading' })
    revalidatePath('/acb-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteAcbReadingAction(readingId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('acb_test_readings')
      .delete()
      .eq('id', readingId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'acb_test_reading', entityId: readingId, summary: 'Deleted ACB test reading' })
    revalidatePath('/acb-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
