'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { closestMatch } from '@/lib/utils/levenshtein'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'
import {
  parseWorkbook,
  type DeltaRow,
  type FrequencyEnum,
  type ParsedGroup,
} from '@/lib/import/delta-wo-parser'

/**
 * Map an EQ frequency enum to the boolean flag column on `job_plan_items`.
 * Kept in sync with `freqColumn` in `app/(app)/maintenance/actions.ts`.
 * Unknown / missing frequencies fall back to `freq_monthly` — defensive
 * default, but the commit action refuses null frequencies before reaching
 * this function.
 */
function freqColumn(freq: string | null): string {
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
  return (freq && map[freq]) ?? 'freq_monthly'
}

// ── Types returned to the UI ────────────────────────────────────────────

/** One asset row within a group preview. */
export interface PreviewAsset {
  rowNumber: number
  workOrder: string
  maximoAssetId: string
  description: string
  location: string | null
  /** Matched EQ asset id or null when no asset with this maximo_id exists. */
  resolvedAssetId: string | null
  /** EQ asset name (for display) when resolved. */
  resolvedAssetName: string | null
  /** WO# already exists on another check_asset for this tenant. */
  duplicateWorkOrder: boolean
  warnings: string[]
}

/** One planned maintenance check — mirrors one `ParsedGroup`. */
export interface PreviewGroup {
  key: string
  siteCode: string
  /** Resolved EQ sites.id or null (site code not found under tenant). */
  siteId: string | null
  siteName: string | null

  jobPlanCodeRaw: string
  /**
   * The code used to query job_plans. Same as `jobPlanCodeRaw` unless an
   * alias or fuzzy candidate is applied/suggested.
   */
  jobPlanCode: string
  /** Matched EQ job_plans row when code exists under the tenant. */
  jobPlanId: string | null
  jobPlanName: string | null

  /** Where the match came from (helps the UI explain itself). */
  matchSource: 'exact' | 'alias' | 'fuzzy' | 'none'
  /** Fuzzy candidate when `matchSource = 'fuzzy'` or suggestion only. */
  fuzzyCandidate: { code: string; distance: number } | null

  frequencySuffix: string
  frequency: FrequencyEnum | null
  /** ISO date (YYYY-MM-DD) — the common Target Start for this group. */
  startDate: string

  assets: PreviewAsset[]
  assetCount: number
  matchedAssetCount: number
  unmatchedAssetCount: number
  duplicateWorkOrderCount: number

  /** Group-level issues bubbled up for quick scanning in the UI. */
  issues: string[]
}

export interface PreviewResult {
  success: true
  filename: string
  parsedRowCount: number
  /** Workbook-level or row-level hard failures from the parser. */
  parseErrors: { rowNumber: number; message: string }[]
  /** Groups sorted by asset count descending. */
  groups: PreviewGroup[]
  /** Unique codes that could not be matched — surface for "add or ignore" prompts. */
  unresolvedJobPlanCodes: string[]
  /** Site codes present in the sheet but not in EQ for this tenant. */
  unresolvedSiteCodes: string[]
}

export type PreviewActionResult =
  | PreviewResult
  | { success: false; error: string }

// ── Action ──────────────────────────────────────────────────────────────

/**
 * Read-only preview of a Delta / Equinix Maximo work-order workbook.
 *
 * Parses the file, resolves sites / job plans / assets against the current
 * tenant, applies any known `job_plan_aliases`, and returns a structured
 * preview the UI can render into an import wizard. Writes nothing — the
 * commit happens in a separate action once the user confirms.
 *
 * Caller must pass a FormData with a single `file` entry.
 */
export async function previewDeltaImportAction(
  formData: FormData,
): Promise<PreviewActionResult> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }
    const filename = file.name || 'upload.xlsx'

    // ── Parse workbook ────────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    const { rows, groups, errors } = await parseWorkbook(buf)

    if (rows.length === 0) {
      return {
        success: true,
        filename,
        parsedRowCount: 0,
        parseErrors: errors,
        groups: [],
        unresolvedJobPlanCodes: [],
        unresolvedSiteCodes: [],
      }
    }

    // ── Resolve sites (siteCode → sites.id, tenant-scoped) ────────────
    const siteCodes = Array.from(new Set(rows.map((r) => r.siteCode)))
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('code', siteCodes)

    const siteByCode = new Map<string, { id: string; name: string }>()
    for (const s of siteRows ?? []) {
      if (s.code) siteByCode.set(s.code, { id: s.id, name: s.name })
    }

    // ── Resolve job plans (all active, tenant-scoped) ─────────────────
    // We pull every active job_plan with a non-null code for this tenant and
    // build lookup tables. Cheap, one round-trip, avoids N queries below.
    const { data: jpRows } = await supabase
      .from('job_plans')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .not('code', 'is', null)

    const jpByCode = new Map<string, { id: string; name: string }>()
    const allCodes: string[] = []
    for (const jp of jpRows ?? []) {
      if (!jp.code) continue
      jpByCode.set(jp.code, { id: jp.id, name: jp.name })
      allCodes.push(jp.code)
    }

    // ── Load aliases for this tenant (source_system='delta') ──────────
    const { data: aliasRows } = await supabase
      .from('job_plan_aliases')
      .select('external_code, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('source_system', 'delta')

    // Map alias → job_plan row
    const aliasMap = new Map<string, { id: string; code: string; name: string }>()
    if (aliasRows && aliasRows.length > 0) {
      const aliasIds = Array.from(
        new Set(aliasRows.map((a) => a.job_plan_id).filter(Boolean)),
      ) as string[]
      if (aliasIds.length > 0) {
        const { data: aliasTargets } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .in('id', aliasIds)
        const targetById = new Map<string, { id: string; code: string; name: string }>()
        for (const t of aliasTargets ?? []) {
          if (t.code) targetById.set(t.id, { id: t.id, code: t.code, name: t.name })
        }
        for (const a of aliasRows) {
          const target = targetById.get(a.job_plan_id)
          if (target) aliasMap.set(a.external_code, target)
        }
      }
    }

    // ── Resolve assets by (site_id, maximo_id) ────────────────────────
    const resolvedSiteIds = Array.from(siteByCode.values()).map((s) => s.id)
    const maximoIds = Array.from(new Set(rows.map((r) => r.maximoAssetId)))

    const assetByKey = new Map<string, { id: string; name: string }>() // key = `${siteId}|${maximoId}`
    if (resolvedSiteIds.length > 0 && maximoIds.length > 0) {
      const { data: assetRows } = await supabase
        .from('assets')
        .select('id, name, site_id, maximo_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('site_id', resolvedSiteIds)
        .in('maximo_id', maximoIds)

      for (const a of assetRows ?? []) {
        if (!a.maximo_id) continue
        assetByKey.set(`${a.site_id}|${a.maximo_id}`, { id: a.id, name: a.name })
      }
    }

    // ── Detect duplicate work orders (tenant-scoped) ──────────────────
    const incomingWOs = Array.from(new Set(rows.map((r) => r.workOrder)))
    const existingWO = new Set<string>()
    if (incomingWOs.length > 0) {
      const { data: dupRows } = await supabase
        .from('check_assets')
        .select('work_order_number')
        .eq('tenant_id', tenantId)
        .in('work_order_number', incomingWOs)
      for (const d of dupRows ?? []) {
        if (d.work_order_number) existingWO.add(d.work_order_number)
      }
    }

    // ── Build preview groups ──────────────────────────────────────────
    const unresolvedJobPlanCodesSet = new Set<string>()
    const unresolvedSiteCodesSet = new Set<string>()

    const previewGroups: PreviewGroup[] = groups.map((g) =>
      buildPreviewGroup(g, {
        siteByCode,
        jpByCode,
        aliasMap,
        allCodes,
        assetByKey,
        existingWO,
        unresolvedJobPlanCodesSet,
        unresolvedSiteCodesSet,
      }),
    )

    return {
      success: true,
      filename,
      parsedRowCount: rows.length,
      parseErrors: errors,
      groups: previewGroups,
      unresolvedJobPlanCodes: Array.from(unresolvedJobPlanCodesSet).sort(),
      unresolvedSiteCodes: Array.from(unresolvedSiteCodesSet).sort(),
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

interface BuildContext {
  siteByCode: Map<string, { id: string; name: string }>
  jpByCode: Map<string, { id: string; name: string }>
  aliasMap: Map<string, { id: string; code: string; name: string }>
  allCodes: string[]
  assetByKey: Map<string, { id: string; name: string }>
  existingWO: Set<string>
  unresolvedJobPlanCodesSet: Set<string>
  unresolvedSiteCodesSet: Set<string>
}

function buildPreviewGroup(g: ParsedGroup, ctx: BuildContext): PreviewGroup {
  const issues: string[] = []

  // Site resolution
  const site = ctx.siteByCode.get(g.siteCode) ?? null
  if (!site) {
    ctx.unresolvedSiteCodesSet.add(g.siteCode)
    issues.push(`Site "${g.siteCode}" not found under this tenant.`)
  }

  // Frequency
  if (!g.frequency) {
    issues.push(
      `Unknown frequency suffix "${g.frequencySuffix}" — manual frequency required.`,
    )
  }

  // Job-plan resolution: exact → alias → fuzzy → none
  let jobPlanCode = g.jobPlanCode
  let jpMatch: { id: string; name: string } | null = ctx.jpByCode.get(jobPlanCode) ?? null
  let matchSource: PreviewGroup['matchSource'] = jpMatch ? 'exact' : 'none'
  let fuzzyCandidate: { code: string; distance: number } | null = null

  if (!jpMatch) {
    // Alias lookup — upstream code → canonical EQ code
    const alias = ctx.aliasMap.get(jobPlanCode)
    if (alias) {
      jpMatch = { id: alias.id, name: alias.name }
      jobPlanCode = alias.code
      matchSource = 'alias'
    }
  }

  if (!jpMatch) {
    // Fuzzy suggestion only — we do NOT auto-apply fuzzy matches; the UI
    // will prompt the user to confirm before the alias is created.
    const near = closestMatch(g.jobPlanCode, ctx.allCodes, 2)
    if (near && near.distance > 0) {
      fuzzyCandidate = { code: near.value, distance: near.distance }
      matchSource = 'fuzzy'
    }
    ctx.unresolvedJobPlanCodesSet.add(g.jobPlanCode)
    issues.push(
      fuzzyCandidate
        ? `Job plan "${g.jobPlanCode}" not found — did you mean "${fuzzyCandidate.code}"?`
        : `Job plan "${g.jobPlanCode}" not found in EQ.`,
    )
  }

  // Asset resolution per row
  const assets: PreviewAsset[] = g.rows.map((r) => resolveRow(r, site?.id ?? null, ctx))
  const matchedAssetCount = assets.filter((a) => a.resolvedAssetId !== null).length
  const unmatchedAssetCount = assets.length - matchedAssetCount
  const duplicateWorkOrderCount = assets.filter((a) => a.duplicateWorkOrder).length

  if (unmatchedAssetCount > 0 && site) {
    issues.push(
      `${unmatchedAssetCount} asset${unmatchedAssetCount === 1 ? '' : 's'} could not be matched by maximo_id at ${g.siteCode}.`,
    )
  }
  if (duplicateWorkOrderCount > 0) {
    issues.push(
      `${duplicateWorkOrderCount} work order${duplicateWorkOrderCount === 1 ? '' : 's'} already exist in EQ.`,
    )
  }

  return {
    key: g.key,
    siteCode: g.siteCode,
    siteId: site?.id ?? null,
    siteName: site?.name ?? null,

    jobPlanCodeRaw: g.jobPlanCode,
    jobPlanCode,
    jobPlanId: jpMatch?.id ?? null,
    jobPlanName: jpMatch?.name ?? null,

    matchSource,
    fuzzyCandidate,

    frequencySuffix: g.frequencySuffix,
    frequency: g.frequency,
    startDate: g.startDate.toISOString().slice(0, 10),

    assets,
    assetCount: assets.length,
    matchedAssetCount,
    unmatchedAssetCount,
    duplicateWorkOrderCount,
    issues,
  }
}

function resolveRow(
  r: DeltaRow,
  siteId: string | null,
  ctx: BuildContext,
): PreviewAsset {
  const warnings = [...r.warnings]
  const duplicateWorkOrder = ctx.existingWO.has(r.workOrder)

  let resolvedAssetId: string | null = null
  let resolvedAssetName: string | null = null
  if (siteId) {
    const match = ctx.assetByKey.get(`${siteId}|${r.maximoAssetId}`)
    if (match) {
      resolvedAssetId = match.id
      resolvedAssetName = match.name
    } else {
      warnings.push(`No EQ asset with maximo_id=${r.maximoAssetId} at ${r.siteCode}`)
    }
  }

  if (duplicateWorkOrder) {
    warnings.push(`Work order ${r.workOrder} already exists in EQ`)
  }

  return {
    rowNumber: r.rowNumber,
    workOrder: r.workOrder,
    maximoAssetId: r.maximoAssetId,
    description: r.description,
    location: r.location,
    resolvedAssetId,
    resolvedAssetName,
    duplicateWorkOrder,
    warnings,
  }
}

// ── Commit action ───────────────────────────────────────────────────────

export interface CommitSummary {
  checksCreated: number
  checkAssetsCreated: number
  checkItemsCreated: number
  groupsCreated: {
    key: string
    checkId: string
    customName: string
    siteCode: string
    jobPlanCode: string
    frequency: FrequencyEnum
    startDate: string
    assetCount: number
    taskCount: number
  }[]
}

export type CommitActionResult = ActionResult<CommitSummary>

/**
 * Commit a previewed Delta import. The caller must upload the SAME workbook
 * that was previewed — we re-parse and re-resolve server-side (the preview
 * payload is not trusted) and refuse if any group still has unresolved
 * sites, codes, frequencies, unmatched assets, or duplicate work orders.
 *
 * Wrapped in `withIdempotency(mutationId)` so a client-side retry or offline
 * replay is safe. The audit row carries the same `mutationId`, and the
 * unique index on `check_assets(tenant_id, work_order_number)` is the
 * database-level backstop if two replays race past the app check.
 */
export async function commitDeltaImportAction(
  formData: FormData,
  mutationId?: string,
): Promise<CommitActionResult> {
  return withIdempotency<CommitSummary>(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }

    // Optional — caller may pass assigned_to to default-assign every created
    // check. Omitted means unassigned.
    const assignedToRaw = formData.get('assigned_to')
    const assignedTo =
      typeof assignedToRaw === 'string' && assignedToRaw.trim().length > 0
        ? assignedToRaw.trim()
        : null

    // ── Parse ─────────────────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    const { rows, groups, errors } = await parseWorkbook(buf)
    if (errors.length > 0) {
      return {
        success: false,
        error: `Parse produced ${errors.length} error(s). Fix the sheet and retry.`,
      }
    }
    if (rows.length === 0 || groups.length === 0) {
      return { success: false, error: 'No importable rows found in workbook.' }
    }

    // ── Resolve (same lookups as the preview) ─────────────────────────
    const siteCodes = Array.from(new Set(rows.map((r) => r.siteCode)))
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('code', siteCodes)

    const siteByCode = new Map<string, { id: string; name: string }>()
    for (const s of siteRows ?? []) {
      if (s.code) siteByCode.set(s.code, { id: s.id, name: s.name })
    }

    const { data: jpRows } = await supabase
      .from('job_plans')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .not('code', 'is', null)

    const jpByCode = new Map<string, { id: string; name: string }>()
    for (const jp of jpRows ?? []) {
      if (jp.code) jpByCode.set(jp.code, { id: jp.id, name: jp.name })
    }

    const { data: aliasRows } = await supabase
      .from('job_plan_aliases')
      .select('external_code, job_plan_id')
      .eq('tenant_id', tenantId)
      .eq('source_system', 'delta')

    const aliasMap = new Map<string, { id: string; code: string; name: string }>()
    if (aliasRows && aliasRows.length > 0) {
      const aliasIds = Array.from(
        new Set(aliasRows.map((a) => a.job_plan_id).filter(Boolean)),
      ) as string[]
      if (aliasIds.length > 0) {
        const { data: aliasTargets } = await supabase
          .from('job_plans')
          .select('id, code, name')
          .in('id', aliasIds)
        const byId = new Map<string, { id: string; code: string; name: string }>()
        for (const t of aliasTargets ?? []) {
          if (t.code) byId.set(t.id, { id: t.id, code: t.code, name: t.name })
        }
        for (const a of aliasRows) {
          const target = byId.get(a.job_plan_id)
          if (target) aliasMap.set(a.external_code, target)
        }
      }
    }

    // Resolved group metadata — populated in the validation pass below.
    const resolvedSiteIds = Array.from(siteByCode.values()).map((s) => s.id)
    const maximoIds = Array.from(new Set(rows.map((r) => r.maximoAssetId)))
    const assetByKey = new Map<string, { id: string; name: string }>()
    if (resolvedSiteIds.length > 0 && maximoIds.length > 0) {
      const { data: assetRows } = await supabase
        .from('assets')
        .select('id, name, site_id, maximo_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('site_id', resolvedSiteIds)
        .in('maximo_id', maximoIds)
      for (const a of assetRows ?? []) {
        if (a.maximo_id) assetByKey.set(`${a.site_id}|${a.maximo_id}`, { id: a.id, name: a.name })
      }
    }

    const incomingWOs = Array.from(new Set(rows.map((r) => r.workOrder)))
    const existingWO = new Set<string>()
    if (incomingWOs.length > 0) {
      const { data: dupRows } = await supabase
        .from('check_assets')
        .select('work_order_number')
        .eq('tenant_id', tenantId)
        .in('work_order_number', incomingWOs)
      for (const d of dupRows ?? []) {
        if (d.work_order_number) existingWO.add(d.work_order_number)
      }
    }

    // ── Validate every group ──────────────────────────────────────────
    interface ResolvedGroup {
      parsed: ParsedGroup
      siteId: string
      siteName: string
      jobPlanId: string
      jobPlanName: string
      frequency: FrequencyEnum
      assetIdByRow: Map<number, string>
    }

    const resolved: ResolvedGroup[] = []
    const blockers: string[] = []

    for (const g of groups) {
      const site = siteByCode.get(g.siteCode)
      if (!site) {
        blockers.push(`Site "${g.siteCode}" not found`)
        continue
      }
      if (!g.frequency) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}/${g.frequencySuffix}: unknown frequency`)
        continue
      }

      let jp = jpByCode.get(g.jobPlanCode) ?? null
      if (!jp) {
        const alias = aliasMap.get(g.jobPlanCode)
        if (alias) jp = { id: alias.id, name: alias.name }
      }
      if (!jp) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}: no matching job plan`)
        continue
      }

      const assetIdByRow = new Map<number, string>()
      let unmatched = 0
      for (const r of g.rows) {
        const match = assetByKey.get(`${site.id}|${r.maximoAssetId}`)
        if (match) {
          assetIdByRow.set(r.rowNumber, match.id)
        } else {
          unmatched++
        }
      }
      if (unmatched > 0) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: ${unmatched} asset(s) not found by maximo_id`,
        )
        continue
      }

      const dupInGroup = g.rows.filter((r) => existingWO.has(r.workOrder)).length
      if (dupInGroup > 0) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: ${dupInGroup} duplicate work order(s)`,
        )
        continue
      }

      resolved.push({
        parsed: g,
        siteId: site.id,
        siteName: site.name,
        jobPlanId: jp.id,
        jobPlanName: jp.name,
        frequency: g.frequency,
        assetIdByRow,
      })
    }

    if (blockers.length > 0) {
      return {
        success: false,
        error: `Cannot commit — ${blockers.length} blocker(s): ${blockers.slice(0, 5).join('; ')}${blockers.length > 5 ? '…' : ''}`,
      }
    }

    // ── Preload job_plan_items for every distinct (jpId, frequency) ───
    const uniquePairs = new Set<string>()
    const pairs: { jpId: string; frequency: FrequencyEnum; col: string }[] = []
    for (const g of resolved) {
      const key = `${g.jobPlanId}|${g.frequency}`
      if (uniquePairs.has(key)) continue
      uniquePairs.add(key)
      pairs.push({
        jpId: g.jobPlanId,
        frequency: g.frequency,
        col: freqColumn(g.frequency),
      })
    }

    /**
     * items lookup: `${jobPlanId}|${frequency}` → items[]
     * Queried per distinct frequency since the freq flag is a column, not a
     * value. In the August fixture there are 3 distinct frequencies so at
     * most 3 queries.
     */
    const itemsByGroup = new Map<string, {
      id: string
      description: string
      sort_order: number
      is_required: boolean
    }[]>()

    const distinctCols = Array.from(new Set(pairs.map((p) => p.col)))
    for (const col of distinctCols) {
      const jpIdsForCol = Array.from(
        new Set(pairs.filter((p) => p.col === col).map((p) => p.jpId)),
      )
      if (jpIdsForCol.length === 0) continue
      const { data: items } = await supabase
        .from('job_plan_items')
        .select('id, job_plan_id, description, sort_order, is_required')
        .in('job_plan_id', jpIdsForCol)
        .eq(col, true)
        .order('sort_order')

      for (const item of items ?? []) {
        for (const p of pairs.filter((p) => p.col === col && p.jpId === item.job_plan_id)) {
          const key = `${p.jpId}|${p.frequency}`
          const arr = itemsByGroup.get(key) ?? []
          arr.push({
            id: item.id,
            description: item.description,
            sort_order: item.sort_order,
            is_required: item.is_required,
          })
          itemsByGroup.set(key, arr)
        }
      }
    }

    // ── Write: per group, insert check + check_assets + check_items ──
    const summary: CommitSummary = {
      checksCreated: 0,
      checkAssetsCreated: 0,
      checkItemsCreated: 0,
      groupsCreated: [],
    }

    for (const g of resolved) {
      const startIso = g.parsed.startDate.toISOString().slice(0, 10)
      const monthName = g.parsed.startDate.toLocaleString('en-AU', { month: 'long' })
      const year = g.parsed.startDate.getFullYear()
      const customName = `${g.siteName} — ${g.jobPlanName} — ${monthName} ${year}`

      // 1. maintenance_checks
      const { data: check, error: checkErr } = await supabase
        .from('maintenance_checks')
        .insert({
          tenant_id: tenantId,
          site_id: g.siteId,
          job_plan_id: g.jobPlanId,
          frequency: g.frequency,
          start_date: startIso,
          due_date: startIso,
          custom_name: customName,
          status: 'scheduled',
          assigned_to: assignedTo,
        })
        .select('id')
        .single()

      if (checkErr || !check) {
        return { success: false, error: checkErr?.message ?? 'Failed to create check.' }
      }

      // 2. check_assets (one per parsed row, with work_order_number)
      const checkAssetRows = g.parsed.rows.map((r) => ({
        tenant_id: tenantId,
        check_id: check.id,
        asset_id: g.assetIdByRow.get(r.rowNumber)!,
        status: 'pending' as const,
        work_order_number: r.workOrder,
      }))

      const { data: insertedCA, error: caErr } = await supabase
        .from('check_assets')
        .insert(checkAssetRows)
        .select('id, asset_id')

      if (caErr || !insertedCA) {
        return { success: false, error: caErr?.message ?? 'Failed to create check assets.' }
      }

      const caByAsset = new Map<string, string>()
      for (const ca of insertedCA) caByAsset.set(ca.asset_id, ca.id)

      // 3. maintenance_check_items (one per asset × matching job_plan_item)
      const items = itemsByGroup.get(`${g.jobPlanId}|${g.frequency}`) ?? []
      const checkItemRows: {
        tenant_id: string
        check_id: string
        check_asset_id: string
        job_plan_item_id: string
        asset_id: string
        description: string
        sort_order: number
        is_required: boolean
      }[] = []

      for (const [assetId, caId] of caByAsset) {
        for (const it of items) {
          checkItemRows.push({
            tenant_id: tenantId,
            check_id: check.id,
            check_asset_id: caId,
            job_plan_item_id: it.id,
            asset_id: assetId,
            description: it.description,
            sort_order: it.sort_order,
            is_required: it.is_required,
          })
        }
      }

      if (checkItemRows.length > 0) {
        for (let i = 0; i < checkItemRows.length; i += 500) {
          const batch = checkItemRows.slice(i, i + 500)
          const { error: itemsErr } = await supabase
            .from('maintenance_check_items')
            .insert(batch)
          if (itemsErr) {
            return { success: false, error: itemsErr.message }
          }
        }
      }

      summary.checksCreated += 1
      summary.checkAssetsCreated += insertedCA.length
      summary.checkItemsCreated += checkItemRows.length
      summary.groupsCreated.push({
        key: g.parsed.key,
        checkId: check.id,
        customName,
        siteCode: g.parsed.siteCode,
        jobPlanCode: g.parsed.jobPlanCode,
        frequency: g.frequency,
        startDate: startIso,
        assetCount: insertedCA.length,
        taskCount: checkItemRows.length,
      })
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Delta import: created ${summary.checksCreated} checks, ${summary.checkAssetsCreated} assets, ${summary.checkItemsCreated} tasks`,
      metadata: {
        source: 'delta_wo_import',
        filename: file.name,
        checksCreated: summary.checksCreated,
      },
      mutationId,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, data: summary }
  })
}
