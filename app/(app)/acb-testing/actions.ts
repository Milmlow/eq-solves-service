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
      cb_rating: formData.get('cb_rating') || null,
      cb_poles: formData.get('cb_poles') || null,
      trip_unit: formData.get('trip_unit') || null,
      trip_settings_ir: formData.get('trip_settings_ir') || null,
      trip_settings_isd: formData.get('trip_settings_isd') || null,
      trip_settings_ii: formData.get('trip_settings_ii') || null,
      trip_settings_ig: formData.get('trip_settings_ig') || null,
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
      cb_rating: formData.get('cb_rating') || null,
      cb_poles: formData.get('cb_poles') || null,
      trip_unit: formData.get('trip_unit') || null,
      trip_settings_ir: formData.get('trip_settings_ir') || null,
      trip_settings_isd: formData.get('trip_settings_isd') || null,
      trip_settings_ii: formData.get('trip_settings_ii') || null,
      trip_settings_ig: formData.get('trip_settings_ig') || null,
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

export async function updateAcbDetailsAction(testId: string, data: {
  cb_make?: string | null
  cb_model?: string | null
  cb_serial?: string | null
  cb_rating?: string | null
  cb_poles?: string | null
  trip_unit?: string | null
  trip_settings_ir?: string | null
  trip_settings_isd?: string | null
  trip_settings_ii?: string | null
  trip_settings_ig?: string | null
  step1_status?: string
  // Asset Collection fields
  brand?: string | null
  breaker_type?: string | null
  name_location?: string | null
  performance_level?: string | null
  protection_unit_fitted?: boolean | null
  trip_unit_model?: string | null
  current_in?: string | null
  fixed_withdrawable?: string | null
  // Protection Settings
  long_time_ir?: string | null
  long_time_delay_tr?: string | null
  short_time_pickup_isd?: string | null
  short_time_delay_tsd?: string | null
  instantaneous_pickup?: string | null
  earth_fault_pickup?: string | null
  earth_fault_delay?: string | null
  earth_leakage_pickup?: string | null
  earth_leakage_delay?: string | null
  // Accessories
  motor_charge?: string | null
  shunt_trip_mx1?: string | null
  shunt_close_xf?: string | null
  undervoltage_mn?: string | null
  second_shunt_trip?: string | null
}) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const updateData: Record<string, unknown> = {}
    for (const key of Object.keys(data)) {
      if (data[key as keyof typeof data] !== undefined) {
        updateData[key] = data[key as keyof typeof data]
      }
    }
    if (Object.keys(updateData).length === 0) {
      return { success: true }
    }

    const { error } = await supabase
      .from('acb_tests')
      .update(updateData)
      .eq('id', testId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: testId, summary: 'Updated ACB circuit breaker details' })
    revalidatePath('/testing/acb')
    revalidatePath('/acb-testing')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function saveAcbVisualCheckAction(testId: string, items: Array<{
  label: string
  result: 'pass' | 'fail' | 'na'
  comment?: string
}>) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Delete existing visual check readings for this test
    await supabase
      .from('acb_test_readings')
      .delete()
      .eq('acb_test_id', testId)
      .like('label', 'Visual Check:%')

    // Insert new readings
    const readings = items.map((item, idx) => ({
      acb_test_id: testId,
      tenant_id: tenantId,
      label: `Visual Check: ${item.label}`,
      value: item.comment || item.result.toUpperCase(),
      unit: null,
      is_pass: item.result === 'pass' ? true : item.result === 'fail' ? false : null,
      sort_order: idx,
    }))

    if (readings.length > 0) {
      const { error } = await supabase
        .from('acb_test_readings')
        .insert(readings)

      if (error) return { success: false, error: error.message }
    }

    // Update step2 status
    await supabase
      .from('acb_tests')
      .update({ step2_status: 'complete' })
      .eq('id', testId)

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: testId, summary: 'Completed ACB visual & functional test' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function saveAcbElectricalReadingAction(testId: string, readings: Array<{
  label: string
  value: string
  unit: string
  is_pass?: boolean
}>) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Delete existing electrical readings for this test
    await supabase
      .from('acb_test_readings')
      .delete()
      .eq('acb_test_id', testId)
      .like('label', 'Electrical:%')

    // Insert new readings
    const insertReadings = readings.map((rdg, idx) => ({
      acb_test_id: testId,
      tenant_id: tenantId,
      label: `Electrical: ${rdg.label}`,
      value: rdg.value,
      unit: rdg.unit,
      is_pass: rdg.is_pass ?? null,
      sort_order: 100 + idx,
    }))

    if (insertReadings.length > 0) {
      const { error } = await supabase
        .from('acb_test_readings')
        .insert(insertReadings)

      if (error) return { success: false, error: error.message }
    }

    // Update step3 status
    await supabase
      .from('acb_tests')
      .update({ step3_status: 'complete' })
      .eq('id', testId)

    await logAuditEvent({ action: 'update', entityType: 'acb_test', entityId: testId, summary: 'Completed ACB electrical testing' })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function raiseTestDefectAction(data: {
  asset_id: string
  site_id: string
  title: string
  description?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
}) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('defects')
      .insert({
        tenant_id: tenantId,
        asset_id: data.asset_id,
        site_id: data.site_id,
        title: data.title,
        description: data.description || null,
        severity: data.severity || 'medium',
        status: 'open',
      })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'defect', summary: `Raised defect from test: ${data.title}` })
    revalidatePath('/testing/acb')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
