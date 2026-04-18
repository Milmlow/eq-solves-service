'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'
import { createNotification } from '@/lib/actions/notifications'
import {
  CreateMaintenanceCheckSchema,
  UpdateMaintenanceCheckSchema,
  UpdateCheckItemResultSchema,
} from '@/lib/validations/maintenance-check'

/**
 * Get the frequency flag column name for a given maintenance frequency.
 */
function freqColumn(freq: string): string {
  const map: Record<string, string> = {
    monthly: 'freq_monthly',
    quarterly: 'freq_quarterly',
    semi_annual: 'freq_semi_annual',
    annual: 'freq_annual',
    '2yr': 'freq_2yr',
    '3yr': 'freq_3yr',
    '5yr': 'freq_5yr',
    '8yr': 'freq_8yr',
    '10yr': 'freq_10yr',
  }
  return map[freq] ?? 'freq_monthly'
}

/**
 * Preview which assets would be included in a check.
 * Used by the form to show a preview before creating.
 */
export async function previewCheckAssetsAction(
  siteId: string,
  frequency: string,
  isDarkSite: boolean,
  jobPlanId?: string | null,
) {
  try {
    const { supabase } = await requireUser()

    let query = supabase
      .from('assets')
      .select('id, name, maximo_id, location, job_plan_id, job_plans(name, code)')
      .eq('site_id', siteId)
      .eq('is_active', true)

    if (isDarkSite) {
      query = query.eq('dark_site_test', true)
    }

    if (jobPlanId) {
      query = query.eq('job_plan_id', jobPlanId)
    }

    const { data: assets } = await query.order('name')

    if (!assets || assets.length === 0) {
      return { success: true, assets: [], totalTasks: 0 }
    }

    // Get job plan IDs from the matched assets
    const jpIds = [...new Set(assets.map((a) => a.job_plan_id).filter(Boolean))] as string[]

    // Count how many tasks each job plan has for this frequency
    const col = freqColumn(frequency)
    let taskCountMap: Record<string, number> = {}
    if (jpIds.length > 0) {
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('job_plan_id')
        .in('job_plan_id', jpIds)
        .eq(col, true)

      taskCountMap = (items ?? []).reduce((acc, item) => {
        acc[item.job_plan_id] = (acc[item.job_plan_id] || 0) + 1
        return acc
      }, {} as Record<string, number>)
    }

    // Filter to only assets whose job plan has tasks for this frequency
    const matchedAssets = assets.filter((a) => {
      if (!a.job_plan_id) return false
      return (taskCountMap[a.job_plan_id] ?? 0) > 0
    })

    const totalTasks = matchedAssets.reduce((sum, a) => {
      return sum + (taskCountMap[a.job_plan_id!] ?? 0)
    }, 0)

    return {
      success: true,
      assets: matchedAssets.map((a) => ({
        id: a.id,
        name: a.name,
        maximo_id: a.maximo_id,
        location: a.location,
        job_plan_name: (a.job_plans as unknown as { name: string; code: string | null } | null)?.name ?? null,
        task_count: taskCountMap[a.job_plan_id!] ?? 0,
      })),
      totalTasks,
    }
  } catch (e: unknown) {
    return { success: false, assets: [], totalTasks: 0, error: (e as Error).message }
  }
}

/**
 * Create a maintenance check with assets and per-asset tasks.
 *
 * Path A (by frequency): system finds all assets at site matching frequency
 * Path B (manual): user provides specific asset IDs
 */
export async function createCheckAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Parse manual_asset_ids from JSON if present
    const manualIdsRaw = formData.get('manual_asset_ids') as string | null
    const manualAssetIds = manualIdsRaw ? JSON.parse(manualIdsRaw) as string[] : undefined

    const raw = {
      site_id: formData.get('site_id'),
      frequency: formData.get('frequency'),
      is_dark_site: formData.get('is_dark_site') === 'true',
      job_plan_id: formData.get('job_plan_id') || null,
      custom_name: formData.get('custom_name') || null,
      start_date: formData.get('start_date'),
      due_date: formData.get('due_date'),
      assigned_to: formData.get('assigned_to') || null,
      maximo_wo_number: formData.get('maximo_wo_number') || null,
      maximo_pm_number: formData.get('maximo_pm_number') || null,
      notes: formData.get('notes') || null,
      manual_asset_ids: manualAssetIds,
    }

    const parsed = CreateMaintenanceCheckSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { manual_asset_ids: parsedManualIds, ...checkData } = parsed.data
    const freq = parsed.data.frequency

    // Auto-generate name as "Site - Month - Year" if not provided
    if (!checkData.custom_name) {
      const { data: site } = await supabase
        .from('sites')
        .select('name')
        .eq('id', checkData.site_id)
        .single()

      const dateObj = new Date(checkData.start_date)
      const monthName = dateObj.toLocaleString('en-AU', { month: 'long' })
      const year = dateObj.getFullYear()
      checkData.custom_name = `${site?.name ?? 'Unknown'} - ${monthName} - ${year}`
    }

    // 1. Insert the maintenance check
    const { data: check, error: checkError } = await supabase
      .from('maintenance_checks')
      .insert({ ...checkData, tenant_id: tenantId })
      .select('id')
      .single()

    if (checkError || !check) return { success: false, error: checkError?.message ?? 'Failed to create check.' }

    // 2. Find assets to include
    let assetQuery = supabase
      .from('assets')
      .select('id, job_plan_id')
      .eq('is_active', true)

    if (parsedManualIds && parsedManualIds.length > 0) {
      // Path B: specific assets
      assetQuery = assetQuery.in('id', parsedManualIds)
    } else {
      // Path A: all assets at site matching criteria
      assetQuery = assetQuery.eq('site_id', parsed.data.site_id)
      if (parsed.data.is_dark_site) {
        assetQuery = assetQuery.eq('dark_site_test', true)
      }
      if (parsed.data.job_plan_id) {
        assetQuery = assetQuery.eq('job_plan_id', parsed.data.job_plan_id)
      }
    }

    const { data: assets } = await assetQuery

    if (!assets || assets.length === 0) {
      return { success: true, checkId: check.id, assetCount: 0, taskCount: 0 }
    }

    // 3. Get job plan items matching the selected frequency
    const col = freqColumn(freq)
    const jpIds = [...new Set(assets.map((a) => a.job_plan_id).filter(Boolean))] as string[]
    let allItems: {
      id: string
      job_plan_id: string
      description: string
      sort_order: number
      is_required: boolean
    }[] = []

    if (jpIds.length > 0) {
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('id, job_plan_id, description, sort_order, is_required')
        .in('job_plan_id', jpIds)
        .eq(col, true)
        .order('sort_order')

      allItems = items ?? []
    }

    // Build lookup: job_plan_id → items
    const itemsByJP: Record<string, typeof allItems> = {}
    for (const item of allItems) {
      if (!itemsByJP[item.job_plan_id]) itemsByJP[item.job_plan_id] = []
      itemsByJP[item.job_plan_id].push(item)
    }

    // 4. Filter to assets whose job plan has matching tasks
    const assetsWithTasks = assets.filter((a) => a.job_plan_id && (itemsByJP[a.job_plan_id]?.length ?? 0) > 0)

    if (assetsWithTasks.length === 0) {
      return { success: true, checkId: check.id, assetCount: 0, taskCount: 0 }
    }

    // 5. Create check_assets rows
    const checkAssetRows = assetsWithTasks.map((a) => ({
      tenant_id: tenantId,
      check_id: check.id,
      asset_id: a.id,
      status: 'pending',
    }))

    const { data: insertedCA, error: caError } = await supabase
      .from('check_assets')
      .insert(checkAssetRows)
      .select('id, asset_id')

    if (caError || !insertedCA) return { success: false, error: caError?.message ?? 'Failed to create check assets.' }

    // 6. Create check_items for each asset (from its job plan items)
    const caLookup: Record<string, string> = {}
    for (const ca of insertedCA) {
      caLookup[ca.asset_id] = ca.id
    }

    const checkItems: {
      tenant_id: string
      check_id: string
      check_asset_id: string
      job_plan_item_id: string
      asset_id: string
      description: string
      sort_order: number
      is_required: boolean
    }[] = []

    for (const asset of assetsWithTasks) {
      const caId = caLookup[asset.id]
      const jpItems = itemsByJP[asset.job_plan_id!] ?? []
      for (const item of jpItems) {
        checkItems.push({
          tenant_id: tenantId,
          check_id: check.id,
          check_asset_id: caId,
          job_plan_item_id: item.id,
          asset_id: asset.id,
          description: item.description,
          sort_order: item.sort_order,
          is_required: item.is_required,
        })
      }
    }

    // Insert in batches of 500
    for (let i = 0; i < checkItems.length; i += 500) {
      const batch = checkItems.slice(i, i + 500)
      const { error: itemsError } = await supabase
        .from('maintenance_check_items')
        .insert(batch)
      if (itemsError) return { success: false, error: itemsError.message }
    }

    // 7. Notification if assigned
    if (parsed.data.assigned_to) {
      const siteName = parsed.data.custom_name ?? 'Maintenance Check'
      await createNotification({
        tenantId,
        userId: parsed.data.assigned_to as string,
        type: 'check_assigned',
        title: `You've been assigned: ${siteName}`,
        body: `Due date: ${parsed.data.due_date} · ${assetsWithTasks.length} assets · ${checkItems.length} tasks`,
        entityType: 'maintenance_check',
        entityId: check.id,
      })
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Created check: ${assetsWithTasks.length} assets, ${checkItems.length} tasks (${freq})`,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, checkId: check.id, assetCount: assetsWithTasks.length, taskCount: checkItems.length }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a maintenance check (status, assigned_to, notes, dates).
 */
export async function updateCheckAction(id: string, formData: FormData) {
  try {
    const { supabase, role, user, tenantId } = await requireUser()

    // Check if user can update: write role OR assigned technician
    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, job_plans(name)')
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

    // Create notification if assigned_to changed
    if (formData.has('assigned_to') && parsed.data.assigned_to && parsed.data.assigned_to !== existing.assigned_to) {
      const jpData = existing.job_plans as unknown as { name: string } | null
      const jobPlanName = jpData?.name ?? 'Maintenance Check'
      await createNotification({
        tenantId,
        userId: parsed.data.assigned_to as string,
        type: 'check_assigned',
        title: `You've been assigned a maintenance check: ${jobPlanName}`,
        entityType: 'maintenance_check',
        entityId: id,
      })
    }

    await logAuditEvent({ action: 'update', entityType: 'maintenance_check', entityId: id, summary: 'Updated maintenance check' })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
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

    await logAuditEvent({ action: 'update', entityType: 'maintenance_check', entityId: id, summary: 'Started maintenance check' })
    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
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
    const { supabase, role, user, tenantId } = await requireUser()

    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status, job_plans(name)')
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

    // Create notification to assigned technician's supervisor (if assigned)
    if (existing.assigned_to && existing.assigned_to !== user.id) {
      const jpData = existing.job_plans as unknown as { name: string } | null
      const jobPlanName = jpData?.name ?? 'Maintenance Check'
      await createNotification({
        tenantId,
        userId: existing.assigned_to as string,
        type: 'check_completed',
        title: `Maintenance check completed: ${jobPlanName}`,
        body: 'This check has been marked as complete.',
        entityType: 'maintenance_check',
        entityId: id,
      })
    }

    await logAuditEvent({ action: 'update', entityType: 'maintenance_check', entityId: id, summary: 'Completed maintenance check' })
    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
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

    await logAuditEvent({ action: 'delete', entityType: 'maintenance_check', entityId: id, summary: 'Cancelled maintenance check' })
    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Archive (soft-delete) a maintenance check — admin only.
 * Hides the check from default list views. Set `active` = true to restore.
 */
export async function archiveCheckAction(id: string, active = false) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin only.' }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ is_active: active })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: active ? 'reactivate' : 'deactivate',
      entityType: 'maintenance_check',
      entityId: id,
      summary: `${active ? 'Restored' : 'Archived'} maintenance check`,
    })
    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check item result (pass/fail/na + notes).
 *
 * Idempotent when called with a `mutationId` — safe to replay from offline
 * queue or retry on transient network failure. The audit row carries the
 * `mutation_id`, so a second call with the same id is detected and skipped.
 */
export async function updateCheckItemAction(
  checkId: string,
  itemId: string,
  formData: FormData,
  mutationId?: string,
) {
  return withIdempotency(mutationId, async () => {
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

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check_item',
      entityId: itemId,
      summary: `Check item ${parsed.data.result ?? 'cleared'}`,
      metadata: { check_id: checkId, result: parsed.data.result, notes: parsed.data.notes },
      mutationId,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  })
}

/**
 * Batch create maintenance checks from a job plan between start and end dates.
 * Calculates check dates based on job plan frequency.
 * Max 52 checks per batch (1 year of weeklies).
 */
export async function batchCreateChecksAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const jobPlanId = formData.get('job_plan_id') as string
    const startDate = formData.get('start_date') as string
    const endDate = formData.get('end_date') as string
    const assignedTo = (formData.get('assigned_to') as string) || null

    if (!jobPlanId || !startDate || !endDate) {
      return { success: false, error: 'Job plan, start date, and end date are required.' }
    }

    // Fetch job plan
    const { data: jobPlan } = await supabase
      .from('job_plans')
      .select('id, site_id, frequency')
      .eq('id', jobPlanId)
      .single()

    if (!jobPlan) return { success: false, error: 'Job plan not found.' }

    // Generate check dates based on frequency
    const start = new Date(startDate)
    const end = new Date(endDate)
    const checkDates: Date[] = []

    const frequency = jobPlan.frequency as string
    let current = new Date(start)

    while (current <= end && checkDates.length < 52) {
      checkDates.push(new Date(current))

      // Advance to next interval based on frequency
      if (frequency === 'weekly') {
        current.setDate(current.getDate() + 7)
      } else if (frequency === 'monthly') {
        current.setMonth(current.getMonth() + 1)
      } else if (frequency === 'quarterly') {
        current.setMonth(current.getMonth() + 3)
      } else if (frequency === 'biannual') {
        current.setMonth(current.getMonth() + 6)
      } else if (frequency === 'annual') {
        current.setFullYear(current.getFullYear() + 1)
      } else {
        // ad_hoc: just use start date
        break
      }
    }

    if (checkDates.length === 0) {
      return { success: false, error: 'No check dates generated for the given range.' }
    }

    // Fetch job plan items once
    const { data: planItems } = await supabase
      .from('job_plan_items')
      .select('id, asset_id, description, sort_order, is_required')
      .eq('job_plan_id', jobPlanId)
      .order('sort_order')

    // Create checks and their items
    let createdCount = 0
    for (const dueDate of checkDates) {
      const dueDateStr = dueDate.toISOString().split('T')[0]

      // Insert the check
      const { data: check } = await supabase
        .from('maintenance_checks')
        .insert({
          tenant_id: tenantId,
          job_plan_id: jobPlanId,
          site_id: jobPlan.site_id,
          assigned_to: assignedTo,
          status: 'scheduled',
          due_date: dueDateStr,
          notes: null,
        })
        .select('id')
        .single()

      if (!check) continue

      // Copy job plan items into check items
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

        await supabase
          .from('maintenance_check_items')
          .insert(checkItems)
      }

      createdCount += 1
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Batch created ${createdCount} checks from job plan`,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, created: createdCount }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Force-complete a check asset — marks the asset as completed and all its check items as 'pass'.
 */
export async function forceCompleteCheckAssetAction(checkId: string, checkAssetId: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const now = new Date().toISOString()

    // Mark all check items for this asset as pass
    const { error: itemsErr } = await supabase
      .from('maintenance_check_items')
      .update({ result: 'pass', completed_at: now, completed_by: user.id })
      .eq('check_asset_id', checkAssetId)
      .is('result', null)

    if (itemsErr) return { success: false, error: itemsErr.message }

    // Mark the check_asset as completed
    const { error: caErr } = await supabase
      .from('check_assets')
      .update({ status: 'completed', completed_at: now })
      .eq('id', checkAssetId)

    if (caErr) return { success: false, error: caErr.message }

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Bulk update work order numbers on check_assets.
 * Accepts an array of { checkAssetId, workOrderNumber } pairs.
 */
export async function bulkUpdateWorkOrdersAction(
  checkId: string,
  updates: { checkAssetId: string; workOrderNumber: string }[]
) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    let updated = 0
    for (const { checkAssetId, workOrderNumber } of updates) {
      const { error } = await supabase
        .from('check_assets')
        .update({ work_order_number: workOrderNumber || null })
        .eq('id', checkAssetId)
        .eq('check_id', checkId)

      if (!error) updated++
    }

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, updated }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check asset's notes or work order number.
 */
export async function updateCheckAssetAction(
  checkId: string,
  checkAssetId: string,
  data: { notes?: string; work_order_number?: string }
) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('check_assets')
      .update(data)
      .eq('id', checkAssetId)
      .eq('check_id', checkId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Complete ALL assets in a check at once.
 * Marks every incomplete item as 'pass' and every check_asset as 'completed'.
 */
export async function raiseDefectAction(data: {
  check_id: string
  check_asset_id?: string
  asset_id?: string
  site_id?: string
  title: string
  description?: string
  severity: string
}) {
  try {
    const { supabase, tenantId, role, user } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    if (!data.title?.trim()) return { success: false, error: 'Title is required.' }

    const { error } = await supabase
      .from('defects')
      .insert({
        tenant_id: tenantId,
        check_id: data.check_id,
        check_asset_id: data.check_asset_id || null,
        asset_id: data.asset_id || null,
        site_id: data.site_id || null,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        severity: data.severity || 'medium',
        status: 'open',
        raised_by: user.id,
      })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'defect', summary: `Raised defect: "${data.title}"` })
    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateDefectAction(defectId: string, updates: {
  status?: string
  severity?: string
  assigned_to?: string | null
  resolution_notes?: string
  work_order_number?: string | null
  work_order_date?: string | null
}) {
  try {
    const { supabase, role, user } = await requireUser()

    // Technicians can update defects assigned to them; writers can update any
    if (!canWrite(role)) {
      const { data: defect } = await supabase
        .from('defects')
        .select('assigned_to')
        .eq('id', defectId)
        .maybeSingle()
      if (!defect || defect.assigned_to !== user.id) {
        return { success: false, error: 'Insufficient permissions.' }
      }
    }

    const updateData: Record<string, unknown> = {}
    if (updates.status) updateData.status = updates.status
    if (updates.severity) updateData.severity = updates.severity
    if (updates.assigned_to !== undefined) updateData.assigned_to = updates.assigned_to
    if (updates.resolution_notes !== undefined) updateData.resolution_notes = updates.resolution_notes
    if (updates.work_order_number !== undefined) updateData.work_order_number = updates.work_order_number
    if (updates.work_order_date !== undefined) updateData.work_order_date = updates.work_order_date

    if (updates.status === 'resolved' || updates.status === 'closed') {
      updateData.resolved_at = new Date().toISOString()
      updateData.resolved_by = user.id
    }

    const { error } = await supabase
      .from('defects')
      .update(updateData)
      .eq('id', defectId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'defect', entityId: defectId, summary: `Updated defect: ${updates.status ? `status → ${updates.status}` : 'fields updated'}` })
    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    revalidatePath('/defects')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function completeAllCheckAssetsAction(checkId: string) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    const now = new Date().toISOString()

    // Mark all incomplete items as pass
    const { error: itemsErr } = await supabase
      .from('maintenance_check_items')
      .update({ result: 'pass', completed_at: now, completed_by: user.id })
      .eq('check_id', checkId)
      .is('result', null)

    if (itemsErr) return { success: false, error: itemsErr.message }

    // Mark all non-completed check_assets as completed
    const { error: caErr } = await supabase
      .from('check_assets')
      .update({ status: 'completed', completed_at: now })
      .eq('check_id', checkId)
      .neq('status', 'completed')

    if (caErr) return { success: false, error: caErr.message }

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Batch force-complete multiple assets at once.
 * Marks each asset as completed and all its incomplete items as 'pass'.
 */
export async function batchForceCompleteAssetsAction(checkId: string, checkAssetIds: string[]) {
  try {
    const { supabase, role, user } = await requireUser()

    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }
    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    if (!checkAssetIds || checkAssetIds.length === 0) {
      return { success: false, error: 'No assets selected.' }
    }

    const now = new Date().toISOString()

    // Mark all incomplete items for selected assets as pass
    const { error: itemsErr } = await supabase
      .from('maintenance_check_items')
      .update({ result: 'pass', completed_at: now, completed_by: user.id })
      .in('check_asset_id', checkAssetIds)
      .is('result', null)

    if (itemsErr) return { success: false, error: itemsErr.message }

    // Mark all selected check_assets as completed
    const { error: caErr } = await supabase
      .from('check_assets')
      .update({ status: 'completed', completed_at: now })
      .in('id', checkAssetIds)

    if (caErr) return { success: false, error: caErr.message }

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Update a check item result (pass/fail/na/null + comments).
 */
export async function updateCheckItemResultAction(
  checkId: string,
  itemId: string,
  result: 'pass' | 'fail' | 'na' | null,
  comment?: string
) {
  try {
    const { supabase, role, user } = await requireUser()

    // Verify check ownership/assignment
    const { data: check } = await supabase
      .from('maintenance_checks')
      .select('assigned_to, status')
      .eq('id', checkId)
      .single()

    if (!check) return { success: false, error: 'Check not found.' }

    const isAssigned = check.assigned_to === user.id
    if (!canWrite(role) && !isAssigned) return { success: false, error: 'Insufficient permissions.' }

    // Build the update payload
    const updateData: Record<string, unknown> = {}

    if (result === null) {
      updateData.result = null
      updateData.completed_at = null
      updateData.completed_by = null
    } else {
      updateData.result = result
      updateData.completed_at = new Date().toISOString()
      updateData.completed_by = user.id
    }

    if (comment !== undefined) {
      updateData.notes = comment || null
    }

    // Get the current item to check its asset
    const { data: item } = await supabase
      .from('maintenance_check_items')
      .select('check_asset_id, result')
      .eq('id', itemId)
      .eq('check_id', checkId)
      .single()

    if (!item) return { success: false, error: 'Item not found.' }

    // Update the item
    const { error: itemErr } = await supabase
      .from('maintenance_check_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('check_id', checkId)

    if (itemErr) return { success: false, error: itemErr.message }

    // If changing a task to 'fail', revert the asset status from 'completed' to 'pending'
    if (result === 'fail' && item.check_asset_id) {
      const { data: asset } = await supabase
        .from('check_assets')
        .select('status')
        .eq('id', item.check_asset_id)
        .single()

      if (asset && asset.status === 'completed') {
        const { error: assetErr } = await supabase
          .from('check_assets')
          .update({ status: 'pending', completed_at: null })
          .eq('id', item.check_asset_id)

        if (assetErr) return { success: false, error: assetErr.message }
      }
    }

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
