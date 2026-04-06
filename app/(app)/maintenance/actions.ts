'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import {
  CreateMaintenanceCheckSchema,
  UpdateMaintenanceCheckSchema,
  UpdateCheckItemResultSchema,
} from '@/lib/validations/maintenance-check'

/**
 * Create a maintenance check from a job plan.
 * Copies all job_plan_items into maintenance_check_items.
 */
export async function createCheckAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      job_plan_id: formData.get('job_plan_id'),
      site_id: formData.get('site_id'),
      assigned_to: formData.get('assigned_to') || null,
      due_date: formData.get('due_date'),
      notes: formData.get('notes') || null,
    }

    const parsed = CreateMaintenanceCheckSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Insert the check
    const { data: check, error: checkError } = await supabase
      .from('maintenance_checks')
      .insert({ ...parsed.data, tenant_id: tenantId })
      .select('id')
      .single()

    if (checkError || !check) return { success: false, error: checkError?.message ?? 'Failed to create check.' }

    // Copy job plan items into check items
    const { data: planItems } = await supabase
      .from('job_plan_items')
      .select('id, asset_id, description, sort_order, is_required')
      .eq('job_plan_id', parsed.data.job_plan_id)
      .order('sort_order')

    if (planItems && planItems.length > 0) {
      const checkItems = planItems.map((item) => ({
        tenant_id: tenantId,
        check_id: check.id,
        job_plan_item_id: item.id,
        asset_id: item.asset_id,
        description: item.description,
        sort_order: item.sort_order,
        is_required: item.is_required,
      }))

      const { error: itemsError } = await supabase
        .from('maintenance_check_items')
        .insert(checkItems)

      if (itemsError) return { success: false, error: itemsError.message }
    }

    revalidatePath('/maintenance')
    return { success: true, checkId: check.id }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a maintenance check (status, assigned_to, notes, dates).
 */
export async function updateCheckAction(id: string, formData: FormData) {
  try {
    const { supabase, role, user } = await requireUser()

    // Check if user can update: write role OR assigned technician
    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const raw: Record<string, unknown> = {}
    if (formData.has('status')) raw.status = formData.get('status')
    if (formData.has('assigned_to')) raw.assigned_to = formData.get('assigned_to') || null
    if (formData.has('due_date')) raw.due_date = formData.get('due_date')
    if (formData.has('notes')) raw.notes = formData.get('notes') || null
    if (formData.has('started_at')) raw.started_at = formData.get('started_at') || null
    if (formData.has('completed_at')) raw.completed_at = formData.get('completed_at') || null

    const parsed = UpdateMaintenanceCheckSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('maintenance_checks')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Start a check — sets status to in_progress and started_at.
 */
export async function startCheckAction(id: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    if (existing.status !== 'scheduled' && existing.status !== 'overdue') {
      return { success: false, error: 'Check cannot be started in its current state.' }
    }

    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Complete a check — validates all required items have results, then sets status to complete.
 */
export async function completeCheckAction(id: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', id)
      .single()

    if (!existing) return { success: false, error: 'Check not found.' }
    if (existing.status !== 'in_progress') {
      return { success: false, error: 'Check must be in progress to complete.' }
    }

    const isAssigned = existing.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    // Validate all required items have results
    const { data: incompleteItems } = await supabase
      .from('maintenance_check_items')
      .select('id')
      .eq('check_id', id)
      .eq('is_required', true)
      .is('result', null)

    if (incompleteItems && incompleteItems.length > 0) {
      return { success: false, error: `${incompleteItems.length} required task(s) still need a result.` }
    }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Cancel a check — admin only.
 */
export async function cancelCheckAction(id: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ status: 'cancelled' })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check item result (pass/fail/na + notes).
 */
export async function updateCheckItemAction(checkId: string, itemId: string, formData: FormData) {
  try {
    const { supabase, role, user } = await requireUser()

    // Verify check ownership/assignment
    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    if (check.status !== 'in_progress') {
      return { success: false, error: 'Check must be in progress to update items.' }
    }

    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      result: formData.get('result') || null,
      notes: formData.get('notes') || null,
    }

    const parsed = UpdateCheckItemResultSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const updateData: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.result) {
      updateData.completed_at = new Date().toISOString()
      updateData.completed_by = user.id
    } else {
      updateData.completed_at = null
      updateData.completed_by = null
    }

    const { error } = await supabase
      .from('maintenance_check_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('check_id', checkId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
