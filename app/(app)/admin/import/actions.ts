'use server'

/**
 * Admin canonical Delta WO importer — server actions.
 *
 * Distinct from the supervisor-grade wizard at `app/(app)/maintenance/import/`:
 *
 *   - Admin role only (isAdmin gate, not canWrite).
 *   - Validates every projected maintenance_check / check_asset against
 *     the canonical JSON Schemas (eq-solves-intake/main) via ajv BEFORE
 *     touching the DB.
 *   - No fuzzy matching, no inline plan creation, no per-row link/create
 *     resolution UI. Sites + plans + assets must already exist; any
 *     unresolved row blocks the whole commit.
 *   - Persists the full Maximo WO payload (priority, work_type, crew_id,
 *     target_start/finish, failure_code, problem, cause, remedy,
 *     classification, ir_scan_result) onto check_assets so the canonical
 *     export endpoint round-trips them.
 */

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'
import {
  parseWorkbook,
  type DeltaRow,
  type FrequencyEnum,
  type ParsedGroup,
} from '@/lib/import/delta-wo-parser'
import type { Database } from '@/lib/supabase/database.types'
import {
  projectMaintenanceCheck,
  projectCheckAsset,
  toDbMaintenanceCheckInsert,
  toDbCheckAssetInsert,
  type CanonicalMaintenanceCheck,
  type CanonicalCheckAsset,
} from '@/lib/import/canonical-project'

type MaintenanceCheckInsert = Database['public']['Tables']['maintenance_checks']['Insert']
type CheckAssetInsert = Database['public']['Tables']['check_assets']['Insert']
import {
  validateMaintenanceCheck,
  validateCheckAsset,
  type CanonicalValidationError,
  VALIDATOR_SCHEMA_IDS,
} from '@/lib/import/canonical-validate'

// ── Preview types returned to the wizard ──────────────────────────────

export interface CanonicalPreviewAsset {
  rowNumber: number
  workOrder: string
  maximoAssetId: string
  description: string
  resolvedAssetId: string | null
  resolvedAssetName: string | null
  /** Canonical projection (with placeholder UUIDs) — null when unresolved. */
  canonical: CanonicalCheckAsset | null
  /** ajv errors on the canonical projection. */
  schemaErrors: CanonicalValidationError[]
}

export interface CanonicalPreviewGroup {
  /** Stable key from the parser. */
  key: string
  siteCode: string
  siteId: string | null
  siteName: string | null
  jobPlanCode: string
  jobPlanId: string | null
  jobPlanName: string | null
  frequencySuffix: string
  frequency: FrequencyEnum | null
  /** ISO YYYY-MM-DD — common Target Start for the group. */
  startDate: string
  /** Canonical maintenance_check projection (placeholder UUID) — null until group resolves. */
  canonicalCheck: CanonicalMaintenanceCheck | null
  /** ajv errors on the canonical_check projection. */
  checkSchemaErrors: CanonicalValidationError[]
  assets: CanonicalPreviewAsset[]
  assetCount: number
  matchedAssetCount: number
  unmatchedAssetCount: number
  duplicateWorkOrderCount: number
  schemaInvalidCount: number
  /** True when every asset row is resolved + canonical-valid AND the check is canonical-valid. */
  commitReady: boolean
  /** Group-level blockers — surfaced in the wizard. */
  issues: string[]
}

export interface CanonicalPreviewResult {
  success: true
  filename: string
  parsedRowCount: number
  parseErrors: { rowNumber: number; message: string }[]
  groups: CanonicalPreviewGroup[]
  unresolvedSiteCodes: string[]
  unresolvedJobPlanCodes: string[]
  duplicateWorkOrders: string[]
  /** Total count of canonical rows (checks + assets) that pass ajv. */
  validRowCount: number
  /** Total count of canonical rows that fail ajv. */
  invalidRowCount: number
  /** Schema $ids the validator was built against — surfaced in the wizard footer. */
  schemaIds: typeof VALIDATOR_SCHEMA_IDS
}

export type CanonicalPreviewActionResult =
  | CanonicalPreviewResult
  | { success: false; error: string }

// ── Commit summary ────────────────────────────────────────────────────

export interface CanonicalCommitSummary {
  checksCreated: number
  checkAssetsCreated: number
  groupsCreated: Array<{
    checkId: string
    siteCode: string
    jobPlanCode: string
    startDate: string
    assetCount: number
  }>
}

export type CanonicalCommitActionResult = ActionResult<CanonicalCommitSummary>

// ── Internal helpers ──────────────────────────────────────────────────

/** Build the human display name for a created check. */
function customNameFor(siteName: string, jobPlanName: string, startDate: Date): string {
  const month = startDate.toLocaleString('en-AU', { month: 'long' })
  return `${siteName} — ${jobPlanName} — ${month} ${startDate.getFullYear()}`
}

interface ResolverMaps {
  siteByCode: Map<string, { id: string; name: string }>
  jpByCode: Map<string, { id: string; name: string }>
  assetByKey: Map<string, { id: string; name: string }> // key = `${siteId}|${maximoId}`
  existingWO: Set<string>
}

type SupabaseAuthed = Awaited<ReturnType<typeof requireUser>>['supabase']

async function buildResolverMaps(
  supabase: SupabaseAuthed,
  tenantId: string,
  rows: DeltaRow[],
): Promise<ResolverMaps> {
  const siteCodes = Array.from(new Set(rows.map((r) => r.siteCode)))
  const jpCodes = Array.from(new Set(rows.map((r) => r.jobPlanCode)))
  const maximoIds = Array.from(new Set(rows.map((r) => r.maximoAssetId)))
  const wos = Array.from(new Set(rows.map((r) => r.workOrder)))

  const { data: siteRows } = await supabase
    .from('sites')
    .select('id, code, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .in('code', siteCodes)

  const siteByCode = new Map<string, { id: string; name: string }>()
  for (const s of (siteRows ?? []) as Array<{ id: string; code: string | null; name: string }>) {
    if (s.code) siteByCode.set(s.code, { id: s.id, name: s.name })
  }

  const { data: jpRows } = await supabase
    .from('job_plans')
    .select('id, code, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .in('code', jpCodes)

  const jpByCode = new Map<string, { id: string; name: string }>()
  for (const jp of (jpRows ?? []) as Array<{ id: string; code: string | null; name: string }>) {
    if (jp.code) jpByCode.set(jp.code, { id: jp.id, name: jp.name })
  }

  const resolvedSiteIds = Array.from(siteByCode.values()).map((s) => s.id)
  const assetByKey = new Map<string, { id: string; name: string }>()
  if (resolvedSiteIds.length > 0 && maximoIds.length > 0) {
    const { data: assetRows } = await supabase
      .from('assets')
      .select('id, name, site_id, maximo_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('site_id', resolvedSiteIds)
      .in('maximo_id', maximoIds)
    for (const a of (assetRows ?? []) as Array<{
      id: string
      name: string
      site_id: string
      maximo_id: string | null
    }>) {
      if (a.maximo_id) assetByKey.set(`${a.site_id}|${a.maximo_id}`, { id: a.id, name: a.name })
    }
  }

  const existingWO = new Set<string>()
  if (wos.length > 0) {
    const { data: dupRows } = await supabase
      .from('check_assets')
      .select('work_order_number')
      .eq('tenant_id', tenantId)
      .in('work_order_number', wos)
    for (const d of (dupRows ?? []) as Array<{ work_order_number: string | null }>) {
      if (d.work_order_number) existingWO.add(d.work_order_number)
    }
  }

  return { siteByCode, jpByCode, assetByKey, existingWO }
}

/**
 * Build the preview view of one parsed group: resolve site / plan / asset
 * ids, build the canonical projections with placeholder UUIDs, and run
 * each through ajv. Returns a self-contained shape the wizard can render
 * without further server calls.
 */
function buildPreviewGroup(
  parsed: ParsedGroup,
  tenantId: string,
  maps: ResolverMaps,
): CanonicalPreviewGroup {
  const site = maps.siteByCode.get(parsed.siteCode) ?? null
  const jp = maps.jpByCode.get(parsed.jobPlanCode) ?? null
  const startIso = parsed.startDate.toISOString().slice(0, 10)
  const placeholderCheckId = '00000000-0000-0000-0000-000000000000'

  const customName = site && jp ? customNameFor(site.name, jp.name, parsed.startDate) : null

  let canonicalCheck: CanonicalMaintenanceCheck | null = null
  let checkSchemaErrors: CanonicalValidationError[] = []
  if (site) {
    canonicalCheck = projectMaintenanceCheck({
      checkId: placeholderCheckId,
      tenantId,
      group: parsed,
      siteId: site.id,
      jobPlanId: jp?.id ?? null,
      customName,
      assignedToUserId: null,
    })
    checkSchemaErrors = validateMaintenanceCheck(canonicalCheck).errors
  }

  const assets: CanonicalPreviewAsset[] = parsed.rows.map((row) => {
    const matched = site ? maps.assetByKey.get(`${site.id}|${row.maximoAssetId}`) : undefined
    let canonical: CanonicalCheckAsset | null = null
    let schemaErrors: CanonicalValidationError[] = []
    if (site && matched) {
      canonical = projectCheckAsset({
        checkAssetId: '00000000-0000-0000-0000-000000000000',
        tenantId,
        checkId: placeholderCheckId,
        assetId: matched.id,
        row,
      })
      schemaErrors = validateCheckAsset(canonical).errors
    }
    return {
      rowNumber: row.rowNumber,
      workOrder: row.workOrder,
      maximoAssetId: row.maximoAssetId,
      description: row.description,
      resolvedAssetId: matched?.id ?? null,
      resolvedAssetName: matched?.name ?? null,
      canonical,
      schemaErrors,
    }
  })

  const matchedAssetCount = assets.filter((a) => a.resolvedAssetId !== null).length
  const unmatchedAssetCount = assets.length - matchedAssetCount
  const duplicateWorkOrderCount = parsed.rows.filter((r) => maps.existingWO.has(r.workOrder)).length
  const schemaInvalidCount =
    assets.filter((a) => a.schemaErrors.length > 0).length + (checkSchemaErrors.length > 0 ? 1 : 0)

  const issues: string[] = []
  if (!site) issues.push(`Site "${parsed.siteCode}" not found under tenant`)
  if (!jp) issues.push(`Job plan "${parsed.jobPlanCode}" not found under tenant`)
  if (!parsed.frequency) issues.push(`Unknown frequency suffix "${parsed.frequencySuffix}"`)
  if (unmatchedAssetCount > 0)
    issues.push(`${unmatchedAssetCount} asset row(s) not resolved by Maximo ID`)
  if (duplicateWorkOrderCount > 0)
    issues.push(`${duplicateWorkOrderCount} work order(s) already exist on another check_asset`)
  if (checkSchemaErrors.length > 0)
    issues.push(
      `Canonical maintenance_check fails ajv (${checkSchemaErrors.map((e) => `${e.path} ${e.message}`).join('; ')})`,
    )
  if (schemaInvalidCount > (checkSchemaErrors.length > 0 ? 1 : 0))
    issues.push(`${assets.filter((a) => a.schemaErrors.length > 0).length} check_asset row(s) fail ajv`)

  const commitReady =
    issues.length === 0 &&
    canonicalCheck !== null &&
    checkSchemaErrors.length === 0 &&
    assets.every((a) => a.canonical !== null && a.schemaErrors.length === 0)

  return {
    key: parsed.key,
    siteCode: parsed.siteCode,
    siteId: site?.id ?? null,
    siteName: site?.name ?? null,
    jobPlanCode: parsed.jobPlanCode,
    jobPlanId: jp?.id ?? null,
    jobPlanName: jp?.name ?? null,
    frequencySuffix: parsed.frequencySuffix,
    frequency: parsed.frequency,
    startDate: startIso,
    canonicalCheck,
    checkSchemaErrors,
    assets,
    assetCount: assets.length,
    matchedAssetCount,
    unmatchedAssetCount,
    duplicateWorkOrderCount,
    schemaInvalidCount,
    commitReady,
    issues,
  }
}

// ── previewDeltaCanonicalAction ───────────────────────────────────────

export async function previewDeltaCanonicalAction(
  formData: FormData,
): Promise<CanonicalPreviewActionResult> {
  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) {
    return { success: false, error: 'Admin role required for the canonical importer.' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, error: 'No file uploaded.' }
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const parsed = await parseWorkbook(buf)
  if (parsed.errors.length > 0 && parsed.rows.length === 0) {
    return {
      success: false,
      error: `Workbook unreadable: ${parsed.errors[0]!.message}`,
    }
  }

  const maps = await buildResolverMaps(supabase, tenantId, parsed.rows)
  const previewGroups = parsed.groups.map((g) => buildPreviewGroup(g, tenantId, maps))

  const unresolvedSiteCodes = Array.from(
    new Set(previewGroups.filter((g) => !g.siteId).map((g) => g.siteCode)),
  )
  const unresolvedJobPlanCodes = Array.from(
    new Set(previewGroups.filter((g) => !g.jobPlanId).map((g) => g.jobPlanCode)),
  )
  const duplicateWorkOrders = Array.from(
    new Set(parsed.rows.filter((r) => maps.existingWO.has(r.workOrder)).map((r) => r.workOrder)),
  )

  let validRowCount = 0
  let invalidRowCount = 0
  for (const g of previewGroups) {
    if (g.canonicalCheck) {
      if (g.checkSchemaErrors.length === 0) validRowCount++
      else invalidRowCount++
    }
    for (const a of g.assets) {
      if (a.canonical) {
        if (a.schemaErrors.length === 0) validRowCount++
        else invalidRowCount++
      }
    }
  }

  return {
    success: true,
    filename: file.name,
    parsedRowCount: parsed.rows.length,
    parseErrors: parsed.errors,
    groups: previewGroups,
    unresolvedSiteCodes,
    unresolvedJobPlanCodes,
    duplicateWorkOrders,
    validRowCount,
    invalidRowCount,
    schemaIds: VALIDATOR_SCHEMA_IDS,
  }
}

// ── commitDeltaCanonicalAction ────────────────────────────────────────

export async function commitDeltaCanonicalAction(
  formData: FormData,
  mutationId?: string,
): Promise<CanonicalCommitActionResult> {
  return withIdempotency<CanonicalCommitSummary>(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) {
      return { success: false, error: 'Admin role required for the canonical importer.' }
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return { success: false, error: 'No file uploaded.' }
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const parsed = await parseWorkbook(buf)
    if (parsed.errors.length > 0) {
      return {
        success: false,
        error: `Parse produced ${parsed.errors.length} error(s). Re-preview and fix the sheet.`,
      }
    }
    if (parsed.groups.length === 0) {
      return { success: false, error: 'No importable rows found.' }
    }

    const maps = await buildResolverMaps(supabase, tenantId, parsed.rows)

    // Build canonical objects + ajv-validate every projection. Reject the
    // whole commit on the first hard error so we never half-import a sheet.
    const checkInserts: MaintenanceCheckInsert[] = []
    const checkAssetInserts: CheckAssetInsert[] = []
    const summaryGroups: CanonicalCommitSummary['groupsCreated'] = []
    const blockers: string[] = []

    for (const g of parsed.groups) {
      const site = maps.siteByCode.get(g.siteCode)
      if (!site) {
        blockers.push(`Site "${g.siteCode}" not resolved`)
        continue
      }
      const jp = maps.jpByCode.get(g.jobPlanCode)
      if (!jp) {
        blockers.push(`Job plan "${g.jobPlanCode}" not resolved`)
        continue
      }
      if (!g.frequency) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: unknown frequency suffix "${g.frequencySuffix}"`,
        )
        continue
      }

      const checkId = randomUUID()
      const canonicalCheck = projectMaintenanceCheck({
        checkId,
        tenantId,
        group: g,
        siteId: site.id,
        jobPlanId: jp.id,
        customName: customNameFor(site.name, jp.name, g.startDate),
        assignedToUserId: null,
      })
      const checkValidation = validateMaintenanceCheck(canonicalCheck)
      if (!checkValidation.valid) {
        blockers.push(
          `Group ${g.siteCode}/${g.jobPlanCode}: canonical maintenance_check fails ajv (${checkValidation.errors.map((e) => `${e.path} ${e.message}`).join('; ')})`,
        )
        continue
      }

      const canonicalAssets: CanonicalCheckAsset[] = []
      let groupHasError = false
      for (const r of g.rows) {
        const asset = maps.assetByKey.get(`${site.id}|${r.maximoAssetId}`)
        if (!asset) {
          blockers.push(
            `Row ${r.rowNumber} (${g.siteCode}): asset with maximo_id "${r.maximoAssetId}" not found`,
          )
          groupHasError = true
          continue
        }
        if (maps.existingWO.has(r.workOrder)) {
          blockers.push(
            `Row ${r.rowNumber} (${g.siteCode}): work_order_number "${r.workOrder}" already exists`,
          )
          groupHasError = true
          continue
        }

        const canonicalAsset = projectCheckAsset({
          checkAssetId: randomUUID(),
          tenantId,
          checkId,
          assetId: asset.id,
          row: r,
        })
        const v = validateCheckAsset(canonicalAsset)
        if (!v.valid) {
          blockers.push(
            `Row ${r.rowNumber}: canonical check_asset fails ajv (${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')})`,
          )
          groupHasError = true
          continue
        }
        canonicalAssets.push(canonicalAsset)
      }

      if (groupHasError) continue

      checkInserts.push(toDbMaintenanceCheckInsert(canonicalCheck))
      for (const a of canonicalAssets) checkAssetInserts.push(toDbCheckAssetInsert(a))
      summaryGroups.push({
        checkId,
        siteCode: g.siteCode,
        jobPlanCode: g.jobPlanCode,
        startDate: canonicalCheck.due_date,
        assetCount: canonicalAssets.length,
      })
    }

    if (blockers.length > 0) {
      return {
        success: false,
        error: `Cannot commit — ${blockers.length} blocker(s): ${blockers.slice(0, 5).join('; ')}${blockers.length > 5 ? `… (+${blockers.length - 5} more)` : ''}`,
      }
    }
    if (checkInserts.length === 0) {
      return { success: false, error: 'No groups passed validation.' }
    }

    // ── Write ────────────────────────────────────────────────────────
    const { error: checksErr } = await supabase.from('maintenance_checks').insert(checkInserts)
    if (checksErr) {
      return { success: false, error: `Insert maintenance_checks failed: ${checksErr.message}` }
    }

    for (let i = 0; i < checkAssetInserts.length; i += 500) {
      const batch = checkAssetInserts.slice(i, i + 500)
      const { error: caErr } = await supabase.from('check_assets').insert(batch)
      if (caErr) {
        return { success: false, error: `Insert check_assets failed: ${caErr.message}` }
      }
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'maintenance_check',
      summary: `Canonical Delta import: ${checkInserts.length} checks, ${checkAssetInserts.length} assets`,
      metadata: {
        source: 'delta_wo_canonical_import',
        filename: file.name,
        schemaIds: VALIDATOR_SCHEMA_IDS,
      },
      mutationId,
    })

    revalidatePath('/maintenance')
    revalidatePath('/admin/import')

    return {
      success: true,
      data: {
        checksCreated: checkInserts.length,
        checkAssetsCreated: checkAssetInserts.length,
        groupsCreated: summaryGroups,
      },
    }
  })
}
