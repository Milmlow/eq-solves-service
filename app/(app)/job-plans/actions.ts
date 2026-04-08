'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import {
  CreateJobPlanSchema,
  UpdateJobPlanSchema,
  CreateJobPlanItemSchema,
  UpdateJobPlanItemSchema,
} from '@/lib/validations/job-plan'

export async function createJobPlanAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id') || null,
      name: formData.get('name'),
      code: formData.get('code') || null,
      type: formData.get('type') || null,
      description: formData.get('description') || null,
      frequency: formData.get('frequency') || null,
    }

    const parsed = CreateJobPlanSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('job_plans')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'job_plan', summary: `Created job plan "${parsed.data.name}"` })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateJobPlanAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id') || null,
      name: formData.get('name'),
      code: formData.get('code') || null,
      type: formData.get('type') || null,
      description: formData.get('description') || null,
      frequency: formData.get('frequency') || null,
    }

    const parsed = UpdateJobPlanSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('job_plans')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'job_plan', entityId: id, summary: 'Updated job plan' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importJobPlansAction(
  jobPlans: {
    name: string
    code: string | null
    type: string | null
    site_id: string
    description: string | null
  }[]
) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.', imported: 0, rowErrors: [] as string[] }

    if (jobPlans.length === 0) return { success: false, error: 'No valid rows to import.', imported: 0, rowErrors: [] as string[] }
    if (jobPlans.length > 500) return { success: false, error: 'Maximum 500 rows per import.', imported: 0, rowErrors: [] as string[] }

    const rowErrors: string[] = []
    const validRows: typeof jobPlans = []

    for (let i = 0; i < jobPlans.length; i++) {
      const row = jobPlans[i]
      if (!row.name?.trim()) { rowErrors.push(`Row ${i + 1}: Name is required.`); continue }
      validRows.push(row)
    }

    if (validRows.length === 0) {
      return { success: false, error: 'No valid rows after validation.', imported: 0, rowErrors }
    }

    const insertRows = validRows.map((r) => ({
      name: r.name,
      code: r.code,
      type: r.type,
      site_id: r.site_id || null,
      description: r.description,
      tenant_id: tenantId,
    }))
    const { error } = await supabase.from('job_plans').insert(insertRows)

    if (error) return { success: false, error: error.message, imported: 0, rowErrors }

    await logAuditEvent({ action: 'create', entityType: 'job_plan', summary: `Imported ${validRows.length} job plans from CSV` })
    revalidatePath('/job-plans')
    return { success: true, imported: validRows.length, rowErrors }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message, imported: 0, rowErrors: [] as string[] }
  }
}

export async function toggleJobPlanActiveAction(id: string, isActive: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('job_plans')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: isActive ? 'update' : 'delete', entityType: 'job_plan', entityId: id, summary: isActive ? 'Reactivated job plan' : 'Deactivated job plan' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// --- Job Plan Items ---

export async function createJobPlanItemAction(jobPlanId: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      description: formData.get('description'),
      sort_order: Number(formData.get('sort_order') ?? 0),
      is_required: formData.get('is_required') === 'true',
      asset_id: formData.get('asset_id') || null,
    }

    const parsed = CreateJobPlanItemSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('job_plan_items')
      .insert({ ...parsed.data, job_plan_id: jobPlanId, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'job_plan_item', summary: 'Added job plan item' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateJobPlanItemAction(jobPlanId: string, itemId: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      description: formData.get('description'),
      sort_order: Number(formData.get('sort_order') ?? 0),
      is_required: formData.get('is_required') === 'true',
    }

    const parsed = UpdateJobPlanItemSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('job_plan_items')
      .update(parsed.data)
      .eq('id', itemId)
      .eq('job_plan_id', jobPlanId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'job_plan_item', entityId: itemId, summary: 'Updated job plan item' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteJobPlanItemAction(jobPlanId: string, itemId: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('job_plan_items')
      .delete()
      .eq('id', itemId)
      .eq('job_plan_id', jobPlanId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'job_plan_item', entityId: itemId, summary: 'Deleted job plan item' })
    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
