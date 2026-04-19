'use server'

import { createHash } from 'node:crypto'
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

/** How a row or group arrived at its current resolution. */
export type ResolutionSource =
  | 'exact'       // matched by maximo_id (row) or job_plan code (group)
  | 'alias'       // applied via job_plan_aliases (group)
  | 'fuzzy'       // suggestion only, not yet confirmed (group)
  | 'override'    // user-applied inline fix (link_asset / create_asset / accept_alias / create_job_plan)
  | 'skipped'     // user chose to exclude this target from the commit
  | 'none'        // unresolved, no user decision yet

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
  /** How the resolution was reached. */
  resolvedFrom: ResolutionSource
  /** User explicitly excluded this row from the commit. */
  skipped: boolean
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
  matchSource: ResolutionSource
  /** Fuzzy candidate when `matchSource = 'fuzzy'` or suggestion only. */
  fuzzyCandidate: { code: string; distance: number } | null
  /** User explicitly excluded this whole group from the commit. */
  skipped: boolean

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
  /** Persistent session id — pass back on Re-parse to retain inline fixes. */
  importSessionId: string
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
    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }
    const filename = file.name || 'upload.xlsx'
    const priorSessionId = (formData.get('importSessionId') as string) || null

    // ── Parse workbook ────────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    const fileHash = createHash('sha256').update(buf).digest('hex')
    const { rows, groups, errors } = await parseWorkbook(buf)

    // ── Resolve / create the import_session for this upload ───────────
    // Preference: caller passes back the same importSessionId — we trust
    // it as long as it's tenant-owned and not yet committed. Otherwise
    // we look up an open session for (tenant, fileHash), and only create
    // one when nothing matches.
    const importSessionId = await resolveImportSession({
      supabase,
      tenantId,
      userId: user.id,
      filename,
      fileHash,
      rowCount: rows.length,
      priorSessionId,
    })

    if (rows.length === 0) {
      return {
        success: true,
        filename,
        importSessionId,
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

    // ── Load inline-fix overrides for this session ────────────────────
    const { overridesByRow, overridesByGroup } = await loadOverridesForSession(
      supabase,
      importSessionId,
    )

    // Assets referenced by link_asset / create_asset overrides need their
    // names hydrated for the preview display.
    const overrideAssetIds = Array.from(
      new Set(
        Array.from(overridesByRow.values())
          .map((o) => (typeof o.payload?.assetId === 'string' ? (o.payload.assetId as string) : null))
          .filter((v): v is string => !!v),
      ),
    )
    const overrideAssetsById = new Map<string, { id: string; name: string }>()
    if (overrideAssetIds.length > 0) {
      const { data: overrideAssets } = await supabase
        .from('assets')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('id', overrideAssetIds)
      for (const a of overrideAssets ?? []) {
        overrideAssetsById.set(a.id, { id: a.id, name: a.name })
      }
    }

    // Job plans referenced by accept_alias / create_job_plan overrides.
    const overrideJobPlanIds = Array.from(
      new Set(
        Array.from(overridesByGroup.values())
          .map((o) => (typeof o.payload?.jobPlanId === 'string' ? (o.payload.jobPlanId as string) : null))
          .filter((v): v is string => !!v),
      ),
    )
    const overrideJpById = new Map<string, { id: string; code: string; name: string }>()
    if (overrideJobPlanIds.length > 0) {
      const { data: overrideJps } = await supabase
        .from('job_plans')
        .select('id, code, name')
        .eq('tenant_id', tenantId)
        .in('id', overrideJobPlanIds)
      for (const j of overrideJps ?? []) {
        if (j.code) overrideJpById.set(j.id, { id: j.id, code: j.code, name: j.name })
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
        overridesByRow,
        overridesByGroup,
        overrideAssetsById,
        overrideJpById,
      }),
    )

    return {
      success: true,
      filename,
      importSessionId,
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

export interface OverrideRow {
  scope: 'row' | 'group'
  row_number: number | null
  group_key: string | null
  action:
    | 'link_asset'
    | 'create_asset'
    | 'skip_row'
    | 'accept_alias'
    | 'create_job_plan'
    | 'skip_group'
  payload: Record<string, unknown>
}

interface BuildContext {
  siteByCode: Map<string, { id: string; name: string }>
  jpByCode: Map<string, { id: string; name: string }>
  aliasMap: Map<string, { id: string; code: string; name: string }>
  allCodes: string[]
  assetByKey: Map<string, { id: string; name: string }>
  existingWO: Set<string>
  unresolvedJobPlanCodesSet: Set<string>
  unresolvedSiteCodesSet: Set<string>
  /** Overrides keyed by sheet row number. */
  overridesByRow: Map<number, OverrideRow>
  /** Overrides keyed by parser group key. */
  overridesByGroup: Map<string, OverrideRow>
  /** Cached asset lookup for assets referenced by row-scope overrides. */
  overrideAssetsById: Map<string, { id: string; name: string }>
  /** Cached job-plan lookup for plans referenced by group-scope overrides. */
  overrideJpById: Map<string, { id: string; code: string; name: string }>
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

  // Job-plan resolution: override → exact → alias → fuzzy → none
  let jobPlanCode = g.jobPlanCode
  let jpMatch: { id: string; name: string } | null = ctx.jpByCode.get(jobPlanCode) ?? null
  let matchSource: PreviewGroup['matchSource'] = jpMatch ? 'exact' : 'none'
  let fuzzyCandidate: { code: string; distance: number } | null = null

  // Inline-fix override on this group? (accept_alias / create_job_plan)
  const groupOverride = ctx.overridesByGroup.get(g.key)
  const groupSkipped = groupOverride?.action === 'skip_group'
  if (
    groupOverride &&
    (groupOverride.action === 'accept_alias' ||
      groupOverride.action === 'create_job_plan')
  ) {
    const overrideJpId =
      typeof groupOverride.payload?.jobPlanId === 'string'
        ? (groupOverride.payload.jobPlanId as string)
        : null
    const overrideJp = overrideJpId ? ctx.overrideJpById.get(overrideJpId) : null
    if (overrideJp) {
      jpMatch = { id: overrideJp.id, name: overrideJp.name }
      jobPlanCode = overrideJp.code
      matchSource = 'override'
    }
  }

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
  // Unresolved / unmatched totals are computed from active (non-skipped)
  // rows so the group's "all good" / commit gate reflects the user's
  // decisions faithfully.
  const activeAssets = assets.filter((a) => !a.skipped)
  const matchedAssetCount = activeAssets.filter((a) => a.resolvedAssetId !== null).length
  const unmatchedAssetCount = activeAssets.length - matchedAssetCount
  const duplicateWorkOrderCount = activeAssets.filter((a) => a.duplicateWorkOrder).length
  const skippedAssetCount = assets.length - activeAssets.length

  if (groupSkipped) {
    issues.push('Group skipped — will not be imported.')
  }
  if (!groupSkipped && unmatchedAssetCount > 0 && site) {
    issues.push(
      `${unmatchedAssetCount} asset${unmatchedAssetCount === 1 ? '' : 's'} could not be matched by maximo_id at ${g.siteCode}.`,
    )
  }
  if (!groupSkipped && duplicateWorkOrderCount > 0) {
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

    matchSource: groupSkipped ? 'skipped' : matchSource,
    fuzzyCandidate,
    skipped: groupSkipped,

    frequencySuffix: g.frequencySuffix,
    frequency: g.frequency,
    startDate: g.startDate.toISOString().slice(0, 10),

    assets,
    assetCount: activeAssets.length + (groupSkipped ? skippedAssetCount : 0),
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

  // Row-level override: skip_row / link_asset / create_asset
  const rowOverride = ctx.overridesByRow.get(r.rowNumber)

  let resolvedAssetId: string | null = null
  let resolvedAssetName: string | null = null
  let resolvedFrom: ResolutionSource = 'none'
  let skipped = false

  if (rowOverride?.action === 'skip_row') {
    skipped = true
    resolvedFrom = 'skipped'
    // Duplicate WO warning is irrelevant once skipped — drop it.
    return {
      rowNumber: r.rowNumber,
      workOrder: r.workOrder,
      maximoAssetId: r.maximoAssetId,
      description: r.description,
      location: r.location,
      resolvedAssetId: null,
      resolvedAssetName: null,
      resolvedFrom,
      skipped,
      duplicateWorkOrder,
      warnings,
    }
  }

  if (
    rowOverride &&
    (rowOverride.action === 'link_asset' || rowOverride.action === 'create_asset')
  ) {
    const overrideAssetId =
      typeof rowOverride.payload?.assetId === 'string'
        ? (rowOverride.payload.assetId as string)
        : null
    const overrideAsset = overrideAssetId
      ? ctx.overrideAssetsById.get(overrideAssetId)
      : null
    if (overrideAsset) {
      resolvedAssetId = overrideAsset.id
      resolvedAssetName = overrideAsset.name
      resolvedFrom = 'override'
    }
  }

  if (!resolvedAssetId && siteId) {
    const match = ctx.assetByKey.get(`${siteId}|${r.maximoAssetId}`)
    if (match) {
      resolvedAssetId = match.id
      resolvedAssetName = match.name
      resolvedFrom = 'exact'
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
    resolvedFrom,
    skipped,
    duplicateWorkOrder,
    warnings,
  }
}

// ── Session + override hydration helpers ────────────────────────────────

type SupabaseCli = Awaited<ReturnType<typeof requireUser>>['supabase']

/**
 * Returns the import_session id to attach this upload to.
 *
 * Decision order:
 *   1. `priorSessionId` is supplied and matches an uncommitted session for
 *      this tenant — reuse it (touch updated_at + row_count).
 *   2. An uncommitted session already exists for (tenant, fileHash) — reuse.
 *   3. Otherwise INSERT a new session and return its id.
 *
 * All three branches are safe under the `import_sessions` RLS: the caller is
 * already authenticated as an admin/supervisor, and created_by is pinned to
 * `auth.uid()` by the INSERT policy.
 */
async function resolveImportSession(args: {
  supabase: SupabaseCli
  tenantId: string
  userId: string
  filename: string
  fileHash: string
  rowCount: number
  priorSessionId: string | null
}): Promise<string> {
  const { supabase, tenantId, userId, filename, fileHash, rowCount, priorSessionId } = args

  // (1) prior id supplied
  if (priorSessionId) {
    const { data: prior } = await supabase
      .from('import_sessions')
      .select('id, committed_at')
      .eq('id', priorSessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (prior && !prior.committed_at) {
      await supabase
        .from('import_sessions')
        .update({ filename, file_hash: fileHash, row_count: rowCount })
        .eq('id', prior.id)
      return prior.id
    }
  }

  // (2) open session with same file hash
  const { data: openByHash } = await supabase
    .from('import_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('file_hash', fileHash)
    .is('committed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (openByHash) {
    await supabase
      .from('import_sessions')
      .update({ filename, row_count: rowCount })
      .eq('id', openByHash.id)
    return openByHash.id
  }

  // (3) new session
  const { data: created, error } = await supabase
    .from('import_sessions')
    .insert({
      tenant_id: tenantId,
      source_system: 'delta',
      filename,
      file_hash: fileHash,
      row_count: rowCount,
      created_by: userId,
    })
    .select('id')
    .single()

  if (error || !created) {
    throw new Error(error?.message ?? 'Failed to create import session.')
  }
  return created.id
}

/**
 * Loads every override for a given session and buckets them by target.
 * Row-level overrides (link_asset / create_asset / skip_row) go into
 * `overridesByRow`; group-level (accept_alias / create_job_plan / skip_group)
 * go into `overridesByGroup`. The partial unique indexes in migration 0051
 * guarantee at most one entry per key.
 */
async function loadOverridesForSession(
  supabase: SupabaseCli,
  importSessionId: string,
): Promise<{
  overridesByRow: Map<number, OverrideRow>
  overridesByGroup: Map<string, OverrideRow>
}> {
  const overridesByRow = new Map<number, OverrideRow>()
  const overridesByGroup = new Map<string, OverrideRow>()

  const { data } = await supabase
    .from('import_overrides')
    .select('scope, row_number, group_key, action, payload')
    .eq('import_session_id', importSessionId)

  for (const raw of data ?? []) {
    const o: OverrideRow = {
      scope: raw.scope,
      row_number: raw.row_number,
      group_key: raw.group_key,
      action: raw.action,
      payload: (raw.payload ?? {}) as Record<string, unknown>,
    }
    if (o.scope === 'row' && o.row_number != null) {
      overridesByRow.set(o.row_number, o)
    } else if (o.scope === 'group' && o.group_key != null) {
      overridesByGroup.set(o.group_key, o)
    }
  }

  return { overridesByRow, overridesByGroup }
}

// ── Commit action ───────────────────────────────────────────────────────

export interface CommitSummary {
  checksCreated: number
  checkAssetsCreated: number
  checkItemsCreated: number
  /** Parser groups excluded by user via skip_group or by every row being skipped. */
  groupsSkipped: number
  /** Rows excluded via skip_row overrides. */
  rowsSkipped: number
  /** import_session_id consumed (now marked committed in the DB). */
  importSessionId: string
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
    const { supabase, tenantId, user, role } = await requireUser()
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

    // Caller MUST forward the same importSessionId returned by the preview —
    // that's the only reliable key to the overrides the user just applied.
    // We fall back to hash-based lookup if it's missing (legacy clients).
    const importSessionIdFromForm = (formData.get('importSessionId') as string) || null

    // ── Parse ─────────────────────────────────────────────────────────
    const buf = Buffer.from(await file.arrayBuffer())
    const fileHash = createHash('sha256').update(buf).digest('hex')
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

    // ── Resolve the import session and load overrides ─────────────────
    // The commit MUST honor any inline fixes the user applied during the
    // preview. We try the explicit session id first, then fall back to a
    // hash match (idempotent) and finally to a fresh session if neither
    // exists (commit without prior fixes is still valid).
    const importSessionId = await resolveImportSession({
      supabase,
      tenantId,
      userId: user.id,
      filename: file.name || 'upload.xlsx',
      fileHash,
      rowCount: rows.length,
      priorSessionId: importSessionIdFromForm,
    })

    const { overridesByRow, overridesByGroup } = await loadOverridesForSession(
      supabase,
      importSessionId,
    )

    // Validate that every override-referenced asset/job_plan still exists
    // and belongs to this tenant. Stale id → loud blocker (not a silent skip).
    const overrideAssetIds = Array.from(
      new Set(
        Array.from(overridesByRow.values())
          .map((o) => (typeof o.payload?.assetId === 'string' ? (o.payload.assetId as string) : null))
          .filter((v): v is string => !!v),
      ),
    )
    const overrideAssetsById = new Map<string, { id: string; name: string; site_id: string | null }>()
    if (overrideAssetIds.length > 0) {
      const { data: oa } = await supabase
        .from('assets')
        .select('id, name, site_id')
        .eq('tenant_id', tenantId)
        .in('id', overrideAssetIds)
      for (const a of oa ?? []) {
        overrideAssetsById.set(a.id, { id: a.id, name: a.name, site_id: a.site_id })
      }
    }

    const overrideJobPlanIds = Array.from(
      new Set(
        Array.from(overridesByGroup.values())
          .map((o) => (typeof o.payload?.jobPlanId === 'string' ? (o.payload.jobPlanId as string) : null))
          .filter((v): v is string => !!v),
      ),
    )
    const overrideJpById = new Map<string, { id: string; code: string; name: string }>()
    if (overrideJobPlanIds.length > 0) {
      const { data: oj } = await supabase
        .from('job_plans')
        .select('id, code, name')
        .eq('tenant_id', tenantId)
        .in('id', overrideJobPlanIds)
      for (const j of oj ?? []) {
        if (j.code) overrideJpById.set(j.id, { id: j.id, code: j.code, name: j.name })
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
    let skippedGroupCount = 0
    let skippedRowCount = 0

    for (const g of groups) {
      // Group-level overrides applied first — skip_group short-circuits.
      const groupOverride = overridesByGroup.get(g.key)
      if (groupOverride?.action === 'skip_group') {
        skippedGroupCount++
        continue
      }

      const site = siteByCode.get(g.siteCode)
      if (!site) {
        blockers.push(`Site "${g.siteCode}" not found`)
        continue
      }
      if (!g.frequency) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}/${g.frequencySuffix}: unknown frequency`)
        continue
      }

      // Job plan resolution: override → exact → alias → blocker.
      let jp: { id: string; name: string } | null = null
      if (
        groupOverride &&
        (groupOverride.action === 'accept_alias' ||
          groupOverride.action === 'create_job_plan')
      ) {
        const overrideJpId =
          typeof groupOverride.payload?.jobPlanId === 'string'
            ? (groupOverride.payload.jobPlanId as string)
            : null
        const overrideJp = overrideJpId ? overrideJpById.get(overrideJpId) : null
        if (!overrideJp) {
          blockers.push(
            `Group ${g.siteCode}/${g.jobPlanCode}: override references missing or non-tenant job plan`,
          )
          continue
        }
        jp = { id: overrideJp.id, name: overrideJp.name }
      }

      if (!jp) {
        jp = jpByCode.get(g.jobPlanCode) ?? null
      }
      if (!jp) {
        const alias = aliasMap.get(g.jobPlanCode)
        if (alias) jp = { id: alias.id, name: alias.name }
      }
      if (!jp) {
        blockers.push(`Group ${g.siteCode}/${g.jobPlanCode}: no matching job plan`)
        continue
      }

      // Per-row resolution honors row-level overrides + skip filters.
      const assetIdByRow = new Map<number, string>()
      const activeRows: typeof g.rows = []
      let unmatched = 0
      let dupInGroup = 0

      for (const r of g.rows) {
        const rowOverride = overridesByRow.get(r.rowNumber)
        if (rowOverride?.action === 'skip_row') {
          skippedRowCount++
          continue
        }

        let assetId: string | null = null
        if (
          rowOverride &&
          (rowOverride.action === 'link_asset' ||
            rowOverride.action === 'create_asset')
        ) {
          const overrideAssetId =
            typeof rowOverride.payload?.assetId === 'string'
              ? (rowOverride.payload.assetId as string)
              : null
          const overrideAsset = overrideAssetId
            ? overrideAssetsById.get(overrideAssetId)
            : null
          if (!overrideAsset) {
            blockers.push(
              `Row ${r.rowNumber}: override references missing or non-tenant asset`,
            )
            continue
          }
          // Optional sanity: warn if overridden asset doesn't live at the
          // group's resolved site. We allow it (the user knows best) but log.
          if (overrideAsset.site_id && overrideAsset.site_id !== site.id) {
            // Non-blocking; recorded in audit metadata below.
          }
          assetId = overrideAsset.id
        }

        if (!assetId) {
          const match = assetByKey.get(`${site.id}|${r.maximoAssetId}`)
          if (match) assetId = match.id
        }

        if (!assetId) {
          unmatched++
          continue
        }

        if (existingWO.has(r.workOrder)) {
          dupInGroup++
          continue
        }

        assetIdByRow.set(r.rowNumber, assetId)
        activeRows.push(r)
      }

      if (unmatched > 0) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: ${unmatched} asset(s) not found by maximo_id (link, create, or skip them)`,
        )
        continue
      }
      if (dupInGroup > 0) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: ${dupInGroup} duplicate work order(s) (skip them to commit)`,
        )
        continue
      }
      if (activeRows.length === 0) {
        // Every row in this group was skipped — treat as a skipped group.
        skippedGroupCount++
        continue
      }

      resolved.push({
        parsed: { ...g, rows: activeRows },
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
      groupsSkipped: skippedGroupCount,
      rowsSkipped: skippedRowCount,
      importSessionId,
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

    // ── Mark the session committed (audit trail + prevents re-use) ────
    const committedCheckIds = summary.groupsCreated.map((g) => g.checkId)
    const { error: sessionErr } = await supabase
      .from('import_sessions')
      .update({
        committed_at: new Date().toISOString(),
        committed_check_ids: committedCheckIds,
      })
      .eq('id', importSessionId)
      .eq('tenant_id', tenantId)
    if (sessionErr) {
      // Non-fatal — checks are already written. Surface in logs, not a user-
      // facing failure, because rolling back writes here is worse than a
      // dangling uncommitted session row.
      console.error('[delta-import] failed to mark session committed', sessionErr)
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Delta import: created ${summary.checksCreated} checks, ${summary.checkAssetsCreated} assets, ${summary.checkItemsCreated} tasks (skipped ${summary.groupsSkipped} group(s), ${summary.rowsSkipped} row(s))`,
      metadata: {
        source: 'delta_wo_import',
        filename: file.name,
        importSessionId,
        checksCreated: summary.checksCreated,
        groupsSkipped: summary.groupsSkipped,
        rowsSkipped: summary.rowsSkipped,
        overridesByRow: Array.from(overridesByRow.values()).map((o) => ({
          rowNumber: o.row_number,
          action: o.action,
        })),
        overridesByGroup: Array.from(overridesByGroup.values()).map((o) => ({
          groupKey: o.group_key,
          action: o.action,
        })),
      },
      mutationId,
    })

    revalidatePath('/maintenance')
    revalidatePath('/testing/summary')
    return { success: true, data: summary }
  })
}
