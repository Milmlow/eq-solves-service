'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin, canWrite } from '@/lib/utils/roles'
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
      site_id: formData.get('site_id'),
      name: formData.get('name'),
      description: formData.get('description') || null,
      frequency: formData.get('frequency'),
    }

    const parsed = CreateJobPlanSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('job_plans')
      .insert({ ...parsed.data, tenant_id: tenantId })

    if (error) return { success: false, error: error.message }

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
      site_id: formData.get('site_id'),
      name: formData.get('name'),
      description: formData.get('description') || null,
      frequency: formData.get('frequency'),
    }

    const parsed = UpdateJobPlanSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('job_plans')
      .update(parsed.data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
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

    revalidatePath('/job-plans')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
