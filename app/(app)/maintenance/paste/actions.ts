'use server'

/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Paste import server actions.
 *
 * Two-step flow:
 *   1. lookupPasteRowsAction  — resolve maximo_id + WO against the DB (read-only)
 *   2. commitPasteImportAction — write checks / assets / items (mutating)
 *
 * Minimum required inputs: asset Maximo ID + work order number.
 * Site, job plan, and location are all inferred from the matched asset record.
 * Frequency and target date are supplied by the user once for the whole batch.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'
import { type FrequencyValue } from '@/lib/import/paste-constants'

function freqColumn(freq: FrequencyValue): string {
  const map: Record<FrequencyValue, string> = {
    monthly:     'freq_monthly',
    quarterly:   'freq_quarterly',
    semi_annual: 'freq_semi_annual',
    annual:      'freq_annual',
    '2yr':       'freq_2yr',
    '3yr':       'freq_3yr',
    '5yr':       'freq_5yr',
    '6yr':       'freq_6yr',
    '8yr':       'freq_8yr',
    '10yr':      'freq_10yr',
  }
  return map[freq]
}

// ── Lookup ───────────────────────────────────────────────────────────────

export interface PasteInputRow {
  maximoAssetId: string
  workOrder: string
}

export interface ResolvedRow {
  maximoAssetId: string
  workOrder: string
  assetId: string
  assetName: string
  siteId: string
  siteName: string
  siteCode: string | null
  jobPlanId: string | null
  jobPlanName: string | null
  jobPlanCode: string | null
  duplicateWorkOrder: boolean
}

export interface UnresolvedRow {
  maximoAssetId: string
  workOrder: string
  reason: string
}

export interface LookupResult {
  success: true
  resolved: ResolvedRow[]
  unresolved: UnresolvedRow[]
}

export type LookupActionResult = LookupResult | { success: false; error: string }

// ── Sites list ────────────────────────────────────────────────────────────

/**
 * Returns all active sites for the tenant — used to populate the site filter
 * on the paste import configure step.
 */
export async function fetchSitesAction(): Promise<{ id: string; name: string; code: string | null }[]> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return []
    const { data } = await supabase
      .from('sites')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name')
    return (data ?? []) as { id: string; name: string; code: string | null }[]
  } catch {
    return []
  }
}

/**
 * Read-only lookup — resolves each (maximoAssetId, workOrder) pair against
 * the current tenant's assets, sites, and job plans. Returns matched and
 * unmatched rows so the UI can show a review before committing.
 *
 * Pass siteId to narrow the asset search to a single site — prevents Maximo
 * ID collisions when the same asset number exists at multiple sites.
 */
export async function lookupPasteRowsAction(
  rows: PasteInputRow[],
  siteId?: string,
): Promise<LookupActionResult> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }
    if (rows.length === 0) return { success: false, error: 'No rows to look up.' }
    if (rows.length > 200) return { success: false, error: 'Maximum 200 rows per paste.' }

    const maximoIds = [...new Set(rows.map((r) => r.maximoAssetId).filter(Boolean))]
    const workOrders = [...new Set(rows.map((r) => r.workOrder).filter(Boolean))]

    // Assets — optionally scoped to a single site to prevent ID collisions
    let assetQuery = supabase
      .from('assets')
      .select('id, name, site_id, maximo_id, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('maximo_id', maximoIds)
    if (siteId) assetQuery = assetQuery.eq('site_id', siteId)
    const { data: assetData } = await assetQuery

    // Sites + job plans in parallel
    const siteIds = [...new Set((assetData ?? []).map((a) => a.site_id))]
    const jpIds = [...new Set(
      (assetData ?? []).map((a) => a.job_plan_id).filter((id): id is string => !!id),
    )]

    const [{ data: siteData }, { data: jpData }] = await Promise.all([
      siteIds.length > 0
        ? supabase.from('sites').select('id, name, code').in('id', siteIds).eq('is_active', true)
        : Promise.resolve({ data: [] as { id: string; name: string; code: string | null }[] }),
      jpIds.length > 0
        ? supabase.from('job_plans').select('id, name, code').in('id', jpIds).eq('is_active', true)
        : Promise.resolve({ data: [] as { id: string; name: string; code: string | null }[] }),
    ])

    const siteById = new Map((siteData ?? []).map((s) => [s.id, s]))
    const jpById   = new Map((jpData  ?? []).map((j) => [j.id, j]))
    // Assets keyed by maximo_id — last write wins on collision (shouldn't happen)
    const assetByMaximoId = new Map(
      (assetData ?? [])
        .filter((a) => a.maximo_id)
        .map((a) => [a.maximo_id as string, a]),
    )

    // Duplicate WO check
    const existingWO = new Set<string>()
    if (workOrders.length > 0) {
      const { data: dupRows } = await supabase
        .from('check_assets')
        .select('work_order_number, maintenance_checks!inner(is_active)')
        .eq('tenant_id', tenantId)
        .in('work_order_number', workOrders)
        .eq('maintenance_checks.is_active', true)
      for (const d of dupRows ?? []) {
        if (d.work_order_number) existingWO.add(d.work_order_number)
      }
    }

    const resolved: ResolvedRow[]   = []
    const unresolved: UnresolvedRow[] = []

    for (const row of rows) {
      const { maximoAssetId, workOrder } = row

      if (!maximoAssetId || !workOrder) {
        unresolved.push({
          maximoAssetId: maximoAssetId || '—',
          workOrder:     workOrder     || '—',
          reason: 'Missing asset ID or work order number.',
        })
        continue
      }

      const asset = assetByMaximoId.get(maximoAssetId)
      if (!asset) {
        unresolved.push({
          maximoAssetId,
          workOrder,
          reason: `Maximo ID ${maximoAssetId} not found under this tenant.`,
        })
        continue
      }

      const site = siteById.get(asset.site_id)
      const jp   = asset.job_plan_id ? jpById.get(asset.job_plan_id) : null

      resolved.push({
        maximoAssetId,
        workOrder,
        assetId:    asset.id,
        assetName:  asset.name,
        siteId:     asset.site_id,
        siteName:   site?.name ?? 'Unknown site',
        siteCode:   site?.code ?? null,
        jobPlanId:   jp?.id   ?? null,
        jobPlanName: jp?.name ?? null,
        jobPlanCode: jp?.code ?? null,
        duplicateWorkOrder: existingWO.has(workOrder),
      })
    }

    return { success: true, resolved, unresolved }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Commit ────────────────────────────────────────────────────────────────

const CommitRowSchema = z.object({
  assetId:    z.string().uuid(),
  workOrder:  z.string().min(1).max(100),
  siteId:     z.string().uuid(),
  siteName:   z.string().min(1).max(200),
  jobPlanId:  z.string().uuid().nullable(),
})

const CommitInputSchema = z.object({
  rows:       z.array(CommitRowSchema).min(1).max(200),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  frequency:  z.enum([
    'monthly', 'quarterly', 'semi_annual', 'annual',
    '2yr', '3yr', '5yr', '6yr', '8yr', '10yr',
  ]),
  customName: z.string().trim().max(200).optional(),
})

export type CommitPasteInput = z.infer<typeof CommitInputSchema>

export interface CommitPasteSummary {
  checksCreated:      number
  checkAssetsCreated: number
  checkItemsCreated:  number
  checks: {
    checkId:    string
    siteName:   string
    assetCount: number
    taskCount:  number
  }[]
}

export type CommitPasteResult = ActionResult<CommitPasteSummary>

/**
 * Commit the resolved rows as maintenance checks.
 *
 * Groups by site — one maintenance_check per site. Each row becomes one
 * check_asset; check_items are generated from the asset's linked job plan
 * filtered by the user-selected frequency.
 *
 * Wrapped in withIdempotency so a client retry is safe.
 */
export async function commitPasteImportAction(
  input: CommitPasteInput,
  mutationId?: string,
): Promise<CommitPasteResult> {
  return withIdempotency<CommitPasteSummary>(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const parsed = CommitInputSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
    }
    const { rows, targetDate, frequency, customName } = parsed.data

    // Re-validate assets still exist and belong to this tenant (never trust client IDs)
    const assetIds  = [...new Set(rows.map((r) => r.assetId))]
    const { data: assetCheck } = await supabase
      .from('assets')
      .select('id, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('id', assetIds)

    const validAssetIds = new Set((assetCheck ?? []).map((a) => a.id))
    const invalidRows   = rows.filter((r) => !validAssetIds.has(r.assetId))
    if (invalidRows.length > 0) {
      return {
        success: false,
        error: `${invalidRows.length} asset(s) could not be verified. Re-run lookup before committing.`,
      }
    }

    // Duplicate WO guard (server-side — don't rely on client preview)
    const workOrders = rows.map((r) => r.workOrder)
    const { data: dupRows } = await supabase
      .from('check_assets')
      .select('work_order_number, maintenance_checks!inner(is_active)')
      .eq('tenant_id', tenantId)
      .in('work_order_number', workOrders)
      .eq('maintenance_checks.is_active', true)
    const existingWO = new Set<string>()
    for (const d of dupRows ?? []) {
      if (d.work_order_number) existingWO.add(d.work_order_number)
    }
    const dupes = rows.filter((r) => existingWO.has(r.workOrder))
    if (dupes.length > 0) {
      const sample = dupes.slice(0, 3).map((r) => r.workOrder).join(', ')
      const more   = dupes.length > 3 ? ` (+${dupes.length - 3} more)` : ''
      return {
        success: false,
        error: `${dupes.length} work order(s) already imported: ${sample}${more}`,
      }
    }

    // Load job plan items for all relevant (jpId, frequency) pairs
    const jpIds = [...new Set(rows.map((r) => r.jobPlanId).filter((id): id is string => !!id))]
    const col   = freqColumn(frequency as FrequencyValue)
    const itemsByJpId = new Map<string, {
      id: string; description: string; sort_order: number; is_required: boolean
    }[]>()

    if (jpIds.length > 0) {
      const { data: itemRows } = await supabase
        .from('job_plan_items')
        .select('id, job_plan_id, description, sort_order, is_required')
        .in('job_plan_id', jpIds)
        .eq(col, true)
        .order('sort_order')
      for (const it of itemRows ?? []) {
        const arr = itemsByJpId.get(it.job_plan_id) ?? []
        arr.push({
          id: it.id, description: it.description,
          sort_order: it.sort_order, is_required: it.is_required,
        })
        itemsByJpId.set(it.job_plan_id, arr)
      }
    }

    // Group by site
    const bySite = new Map<string, { siteName: string; rows: typeof rows }>()
    for (const row of rows) {
      const entry = bySite.get(row.siteId) ?? { siteName: row.siteName, rows: [] }
      entry.rows.push(row)
      bySite.set(row.siteId, entry)
    }

    // Auto-generate name from site + month + year when not overridden
    const dateObj   = new Date(`${targetDate}T00:00:00`)
    const monthName = dateObj.toLocaleString('en-AU', { month: 'long' })
    const year      = dateObj.getFullYear()

    const summary: CommitPasteSummary = {
      checksCreated:      0,
      checkAssetsCreated: 0,
      checkItemsCreated:  0,
      checks:             [],
    }

    for (const [siteId, { siteName, rows: siteRows }] of bySite) {
      const checkName = customName ?? `${siteName} — ${monthName} ${year}`

      const { data: check, error: checkErr } = await supabase
        .from('maintenance_checks')
        .insert((() => {
          // frequency_tags is not in the generated types (column post-dates last regen).
          const base = {
            tenant_id:   tenantId,
            site_id:     siteId,
            kind:        'maintenance' as const,
            job_plan_id: null,
            frequency:   frequency,
            start_date:  targetDate,
            due_date:    targetDate,
            custom_name: checkName,
            status:      'scheduled' as const,
          }
          return { ...base, frequency_tags: [frequency] } as typeof base
        })())
        .select('id')
        .single()

      if (checkErr || !check) {
        return { success: false, error: checkErr?.message ?? 'Failed to create check.' }
      }

      const rollback = async (reason: string): Promise<string> => {
        await supabase.from('maintenance_checks').delete().eq('id', check.id)
        return reason
      }

      // check_assets — one per row
      const { data: insertedCA, error: caErr } = await supabase
        .from('check_assets')
        .insert(
          siteRows.map((row) => ({
            tenant_id:          tenantId,
            check_id:           check.id,
            asset_id:           row.assetId,
            status:             'pending' as const,
            work_order_number:  row.workOrder,
          })),
        )
        .select('id, asset_id')

      if (caErr || !insertedCA) {
        const reason = await rollback(caErr?.message ?? 'Failed to create check assets.')
        return { success: false, error: reason }
      }

      const caByAssetId = new Map(insertedCA.map((ca) => [ca.asset_id, ca.id]))

      // check_items — from each asset's job plan filtered by frequency
      const checkItemRows: {
        tenant_id:         string
        check_id:          string
        check_asset_id:    string
        job_plan_item_id:  string
        asset_id:          string
        description:       string
        sort_order:        number
        is_required:       boolean
      }[] = []

      for (const row of siteRows) {
        if (!row.jobPlanId) continue
        const caId  = caByAssetId.get(row.assetId)
        if (!caId) continue
        const items = itemsByJpId.get(row.jobPlanId) ?? []
        for (const it of items) {
          checkItemRows.push({
            tenant_id:        tenantId,
            check_id:         check.id,
            check_asset_id:   caId,
            job_plan_item_id: it.id,
            asset_id:         row.assetId,
            description:      it.description,
            sort_order:       it.sort_order,
            is_required:      it.is_required,
          })
        }
      }

      if (checkItemRows.length > 0) {
        for (let i = 0; i < checkItemRows.length; i += 500) {
          const { error: itemsErr } = await supabase
            .from('maintenance_check_items')
            .insert(checkItemRows.slice(i, i + 500))
          if (itemsErr) {
            const reason = await rollback(itemsErr.message)
            return { success: false, error: reason }
          }
        }
      }

      summary.checksCreated      += 1
      summary.checkAssetsCreated += insertedCA.length
      summary.checkItemsCreated  += checkItemRows.length
      summary.checks.push({
        checkId:    check.id,
        siteName,
        assetCount: insertedCA.length,
        taskCount:  checkItemRows.length,
      })
    }

    await logAuditEvent({
      action:     'create',
      entityType: 'maintenance_check',
      summary:    `Paste import: ${summary.checksCreated} check(s), ${summary.checkAssetsCreated} asset(s), ${summary.checkItemsCreated} task(s)`,
      metadata:   {
        source:        'paste_import',
        frequency,
        targetDate,
        checksCreated: summary.checksCreated,
      },
      mutationId,
    })

    revalidatePath('/maintenance')
    return { success: true, data: summary }
  })
}
