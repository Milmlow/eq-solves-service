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
      dark_site: formData.get('dark_site') === 'true',
      freq_monthly: formData.get('freq_monthly') === 'true',
      freq_quarterly: formData.get('freq_quarterly') === 'true',
      freq_semi_annual: formData.get('freq_semi_annual') === 'true',
      freq_annual: formData.get('freq_annual') === 'true',
      freq_2yr: formData.get('freq_2yr') === 'true',
      freq_3yr: formData.get('freq_3yr') === 'true',
      freq_5yr: formData.get('freq_5yr') === 'true',
      freq_8yr: formData.get('freq_8yr') === 'true',
      freq_10yr: formData.get('freq_10yr') === 'true',
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

    // Only include keys that are actually present in the FormData so callers
    // can do partial updates (e.g. updating just frequency flags from the
    // master register without touching description / sort_order).
    const raw: Record<string, unknown> = {}
    if (formData.has('description')) raw.description = formData.get('description')
    if (formData.has('sort_order')) raw.sort_order = Number(formData.get('sort_order') ?? 0)
    if (formData.has('is_required')) raw.is_required = formData.get('is_required') === 'true'
    if (formData.has('dark_site')) raw.dark_site = formData.get('dark_site') === 'true'
    if (formData.has('freq_monthly')) raw.freq_monthly = formData.get('freq_monthly') === 'true'
    if (formData.has('freq_quarterly')) raw.freq_quarterly = formData.get('freq_quarterly') === 'true'
    if (formData.has('freq_semi_annual')) raw.freq_semi_annual = formData.get('freq_semi_annual') === 'true'
    if (formData.has('freq_annual')) raw.freq_annual = formData.get('freq_annual') === 'true'
    if (formData.has('freq_2yr')) raw.freq_2yr = formData.get('freq_2yr') === 'true'
    if (formData.has('freq_3yr')) raw.freq_3yr = formData.get('freq_3yr') === 'true'
    if (formData.has('freq_5yr')) raw.freq_5yr = formData.get('freq_5yr') === 'true'
    if (formData.has('freq_8yr')) raw.freq_8yr = formData.get('freq_8yr') === 'true'
    if (formData.has('freq_10yr')) raw.freq_10yr = formData.get('freq_10yr') === 'true'

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

// --- Import / Upsert Job Plan Items (CSV round-trip) ---

interface ImportJobPlanItemRow {
  /** If present and non-empty → update. If blank → create. */
  item_id: string | null
  /** Required for creates. Used for update ownership checks. */
  plan_id: string | null
  description: string | null
  sort_order: number | null
  is_required: boolean
  dark_site: boolean
  freq_monthly: boolean
  freq_quarterly: boolean
  freq_semi_annual: boolean
  freq_annual: boolean
  freq_2yr: boolean
  freq_3yr: boolean
  freq_5yr: boolean
  freq_8yr: boolean
  freq_10yr: boolean
}

/**
 * Bulk upsert job plan items from a CSV round-trip.
 *
 * Rows with a valid `item_id` → update the matching row.
 * Rows without `item_id` but with `plan_id` → create new.
 * Rows missing both → row-level error.
 *
 * The CSV is produced by the Items Register's "Export CSV" button which
 * includes `item_id` and `plan_id` as the first two columns.
 */
export async function importJobPlanItemsAction(
  items: ImportJobPlanItemRow[]
): Promise<{
  success: boolean
  imported: number
  rowErrors: string[]
  error?: string
}> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, imported: 0, rowErrors: [], error: 'Insufficient permissions.' }

    if (items.length === 0) return { success: false, imported: 0, rowErrors: [], error: 'No rows to import.' }
    if (items.length > 500) return { success: false, imported: 0, rowErrors: [], error: 'Maximum 500 rows per import.' }

    const rowErrors: string[] = []
    let updated = 0
    let created = 0

    for (let i = 0; i < items.length; i++) {
      const row = items[i]
      const rowNum = i + 1

      if (!row.description?.trim()) {
        rowErrors.push(`Row ${rowNum}: Description is required.`)
        continue
      }

      const payload = {
        description: row.description.trim(),
        sort_order: row.sort_order ?? 0,
        is_required: row.is_required,
        dark_site: row.dark_site,
        freq_monthly: row.freq_monthly,
        freq_quarterly: row.freq_quarterly,
        freq_semi_annual: row.freq_semi_annual,
        freq_annual: row.freq_annual,
        freq_2yr: row.freq_2yr,
        freq_3yr: row.freq_3yr,
        freq_5yr: row.freq_5yr,
        freq_8yr: row.freq_8yr,
        freq_10yr: row.freq_10yr,
      }

      if (row.item_id?.trim()) {
        // UPDATE existing item — RLS ensures tenant isolation.
        const { error } = await supabase
          .from('job_plan_items')
          .update(payload)
          .eq('id', row.item_id.trim())

        if (error) {
          rowErrors.push(`Row ${rowNum}: ${error.message}`)
        } else {
          updated++
        }
      } else if (row.plan_id?.trim()) {
        // CREATE new item under the specified plan.
        const { error } = await supabase
          .from('job_plan_items')
          .insert({
            ...payload,
            job_plan_id: row.plan_id.trim(),
            tenant_id: tenantId,
          })

        if (error) {
          rowErrors.push(`Row ${rowNum}: ${error.message}`)
        } else {
          created++
        }
      } else {
        rowErrors.push(`Row ${rowNum}: Needs either Item ID (to update) or Plan ID (to create).`)
      }
    }

    const total = updated + created
    if (total > 0) {
      await logAuditEvent({
        action: 'update',
        entityType: 'job_plan_item',
        summary: `CSV import: ${updated} updated, ${created} created (${rowErrors.length} errors)`,
      })
      revalidatePath('/job-plans')
      revalidatePath('/job-plans/items')
    }

    return { success: true, imported: total, rowErrors }
  } catch (e: unknown) {
    return { success: false, imported: 0, rowErrors: [], error: (e as Error).message }
  }
}
