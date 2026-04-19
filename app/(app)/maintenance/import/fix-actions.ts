'use server'

/**
 * Inline-fix server actions for the Delta WO import wizard.
 *
 * Each action captures a user decision against the current `import_session`
 * (accept fuzzy alias, create a missing job plan, link a row to an EQ
 * asset, create a new EQ asset, skip a row, skip a group) and persists it
 * to `import_overrides`. The wizard then re-runs `previewDeltaImportAction`
 * to re-render with the override applied.
 *
 * All actions follow the project pattern:
 *   requireUser() → canWrite() → Zod → mutation → audit → revalidatePath
 *
 * See migration 0051 for the schema.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { CreateAssetSchema } from '@/lib/validations/asset'
import { CreateJobPlanSchema } from '@/lib/validations/job-plan'

// ── Shared result type ──────────────────────────────────────────────────

export type FixResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string }

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Upsert an override row for a given target, replacing any prior override
 * on the same (session, target) so the user can change their mind.
 */
async function upsertOverride(args: {
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase']
  tenantId: string
  userId: string
  importSessionId: string
  scope: 'row' | 'group'
  rowNumber: number | null
  groupKey: string | null
  action:
    | 'link_asset'
    | 'create_asset'
    | 'skip_row'
    | 'accept_alias'
    | 'create_job_plan'
    | 'skip_group'
  payload: Record<string, unknown>
}) {
  const {
    supabase,
    tenantId,
    userId,
    importSessionId,
    scope,
    rowNumber,
    groupKey,
    action,
    payload,
  } = args

  // Delete any existing override on the same target (partial unique index
  // tolerates only one active row per target, and ON CONFLICT does not play
  // well with partial indexes on different columns for the two scopes).
  const targetCol = scope === 'row' ? 'row_number' : 'group_key'
  const targetVal: number | string | null = scope === 'row' ? rowNumber : groupKey
  await supabase
    .from('import_overrides')
    .delete()
    .eq('import_session_id', importSessionId)
    .eq('scope', scope)
    .eq(targetCol, targetVal as never)

  const { error } = await supabase.from('import_overrides').insert({
    tenant_id: tenantId,
    import_session_id: importSessionId,
    scope,
    row_number: rowNumber,
    group_key: groupKey,
    action,
    payload,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
}

/** Confirm the session belongs to the tenant and is still open. */
async function loadOpenSession(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  tenantId: string,
  importSessionId: string,
) {
  const { data, error } = await supabase
    .from('import_sessions')
    .select('id, tenant_id, committed_at')
    .eq('id', importSessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Import session not found.')
  if (data.committed_at)
    throw new Error('This import has already been committed; start a new upload.')
  return data
}

// ── 1. Accept fuzzy alias ───────────────────────────────────────────────

const AcceptAliasSchema = z.object({
  importSessionId: z.string().uuid(),
  groupKey: z.string().min(1),
  externalCode: z.string().min(1).max(50),
  jobPlanId: z.string().uuid(),
})

/**
 * Creates (or reuses) a `job_plan_aliases` row mapping `externalCode` →
 * `jobPlanId` for this tenant, and records an `accept_alias` override on
 * the group. Future imports from the same upstream will then resolve
 * silently via the alias map.
 */
export async function acceptAliasAction(
  input: z.infer<typeof AcceptAliasSchema>,
): Promise<FixResult<{ aliasId: string }>> {
  try {
    const parsed = AcceptAliasSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    // Confirm the job plan belongs to this tenant.
    const { data: jp } = await supabase
      .from('job_plans')
      .select('id, code, name')
      .eq('id', parsed.data.jobPlanId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    if (!jp) return { success: false, error: 'Job plan not found.' }

    // Upsert alias (UNIQUE on tenant, source_system, external_code).
    const { data: existing } = await supabase
      .from('job_plan_aliases')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('source_system', 'delta')
      .eq('external_code', parsed.data.externalCode)
      .maybeSingle()

    let aliasId: string
    if (existing) {
      const { error } = await supabase
        .from('job_plan_aliases')
        .update({ job_plan_id: parsed.data.jobPlanId })
        .eq('id', existing.id)
      if (error) return { success: false, error: error.message }
      aliasId = existing.id
    } else {
      const { data, error } = await supabase
        .from('job_plan_aliases')
        .insert({
          tenant_id: tenantId,
          source_system: 'delta',
          external_code: parsed.data.externalCode,
          job_plan_id: parsed.data.jobPlanId,
          created_by: user.id,
        })
        .select('id')
        .single()
      if (error || !data) return { success: false, error: error?.message ?? 'Insert failed.' }
      aliasId = data.id
    }

    await upsertOverride({
      supabase,
      tenantId,
      userId: user.id,
      importSessionId: parsed.data.importSessionId,
      scope: 'group',
      rowNumber: null,
      groupKey: parsed.data.groupKey,
      action: 'accept_alias',
      payload: { jobPlanId: parsed.data.jobPlanId, aliasId },
    })

    await logAuditEvent({
      action: 'create',
      entityType: 'job_plan_alias',
      entityId: aliasId,
      summary: `Accepted alias ${parsed.data.externalCode} → ${jp.code} during WO import`,
      metadata: {
        importSessionId: parsed.data.importSessionId,
        groupKey: parsed.data.groupKey,
      },
    })

    revalidatePath('/maintenance/import')
    return { success: true, data: { aliasId } }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 2. Create a missing job plan during import ──────────────────────────

const CreateJobPlanFromImportSchema = z.object({
  importSessionId: z.string().uuid(),
  groupKey: z.string().min(1),
  jobPlan: CreateJobPlanSchema,
})

export async function createJobPlanFromImportAction(
  input: z.infer<typeof CreateJobPlanFromImportSchema>,
): Promise<FixResult<{ jobPlanId: string }>> {
  try {
    const parsed = CreateJobPlanFromImportSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    const { data, error } = await supabase
      .from('job_plans')
      .insert({ ...parsed.data.jobPlan, tenant_id: tenantId })
      .select('id, code, name')
      .single()
    if (error || !data) return { success: false, error: error?.message ?? 'Insert failed.' }

    await upsertOverride({
      supabase,
      tenantId,
      userId: user.id,
      importSessionId: parsed.data.importSessionId,
      scope: 'group',
      rowNumber: null,
      groupKey: parsed.data.groupKey,
      action: 'create_job_plan',
      payload: { jobPlanId: data.id },
    })

    await logAuditEvent({
      action: 'create',
      entityType: 'job_plan',
      entityId: data.id,
      summary: `Created job plan "${data.name}" (${data.code ?? '—'}) during WO import`,
      metadata: {
        importSessionId: parsed.data.importSessionId,
        groupKey: parsed.data.groupKey,
      },
    })

    revalidatePath('/maintenance/import')
    revalidatePath('/job-plans')
    return { success: true, data: { jobPlanId: data.id } }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 3. Skip a whole group ───────────────────────────────────────────────

const SkipGroupSchema = z.object({
  importSessionId: z.string().uuid(),
  groupKey: z.string().min(1),
})

export async function skipGroupAction(
  input: z.infer<typeof SkipGroupSchema>,
): Promise<FixResult> {
  try {
    const parsed = SkipGroupSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    await upsertOverride({
      supabase,
      tenantId,
      userId: user.id,
      importSessionId: parsed.data.importSessionId,
      scope: 'group',
      rowNumber: null,
      groupKey: parsed.data.groupKey,
      action: 'skip_group',
      payload: {},
    })

    await logAuditEvent({
      action: 'update',
      entityType: 'import_session',
      entityId: parsed.data.importSessionId,
      summary: `Skipped group ${parsed.data.groupKey} during WO import`,
    })

    revalidatePath('/maintenance/import')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 4. Link a row to an existing EQ asset ───────────────────────────────

const LinkAssetSchema = z.object({
  importSessionId: z.string().uuid(),
  rowNumber: z.number().int().min(1),
  assetId: z.string().uuid(),
})

export async function linkAssetToRowAction(
  input: z.infer<typeof LinkAssetSchema>,
): Promise<FixResult> {
  try {
    const parsed = LinkAssetSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    // Confirm the asset belongs to this tenant and is active.
    const { data: asset } = await supabase
      .from('assets')
      .select('id, name')
      .eq('id', parsed.data.assetId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle()
    if (!asset) return { success: false, error: 'Asset not found.' }

    await upsertOverride({
      supabase,
      tenantId,
      userId: user.id,
      importSessionId: parsed.data.importSessionId,
      scope: 'row',
      rowNumber: parsed.data.rowNumber,
      groupKey: null,
      action: 'link_asset',
      payload: { assetId: parsed.data.assetId },
    })

    await logAuditEvent({
      action: 'update',
      entityType: 'import_session',
      entityId: parsed.data.importSessionId,
      summary: `Linked row ${parsed.data.rowNumber} to asset "${asset.name}"`,
      metadata: { rowNumber: parsed.data.rowNumber, assetId: parsed.data.assetId },
    })

    revalidatePath('/maintenance/import')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 5. Create a new EQ asset for a row ──────────────────────────────────

const CreateAssetFromRowSchema = z.object({
  importSessionId: z.string().uuid(),
  rowNumber: z.number().int().min(1),
  asset: CreateAssetSchema,
})

export async function createAssetFromRowAction(
  input: z.infer<typeof CreateAssetFromRowSchema>,
): Promise<FixResult<{ assetId: string }>> {
  try {
    const parsed = CreateAssetFromRowSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    // Tenant-scope the site on the way in.
    const { data: site } = await supabase
      .from('sites')
      .select('id')
      .eq('id', parsed.data.asset.site_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!site) return { success: false, error: 'Site not found for tenant.' }

    const { data, error } = await supabase
      .from('assets')
      .insert({ ...parsed.data.asset, tenant_id: tenantId })
      .select('id, name')
      .single()
    if (error || !data) return { success: false, error: error?.message ?? 'Insert failed.' }

    await upsertOverride({
      supabase,
      tenantId,
      userId: user.id,
      importSessionId: parsed.data.importSessionId,
      scope: 'row',
      rowNumber: parsed.data.rowNumber,
      groupKey: null,
      action: 'create_asset',
      payload: { assetId: data.id },
    })

    await logAuditEvent({
      action: 'create',
      entityType: 'asset',
      entityId: data.id,
      summary: `Created asset "${data.name}" from import row ${parsed.data.rowNumber}`,
      metadata: {
        importSessionId: parsed.data.importSessionId,
        rowNumber: parsed.data.rowNumber,
      },
    })

    revalidatePath('/maintenance/import')
    revalidatePath('/assets')
    return { success: true, data: { assetId: data.id } }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 6. Skip a row ───────────────────────────────────────────────────────

const SkipRowSchema = z.object({
  importSessionId: z.string().uuid(),
  rowNumber: z.number().int().min(1),
})

export async function skipRowAction(
  input: z.infer<typeof SkipRowSchema>,
): Promise<FixResult> {
  try {
    const parsed = SkipRowSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, user, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    await upsertOverride({
      supabase,
      tenantId,
      userId: user.id,
      importSessionId: parsed.data.importSessionId,
      scope: 'row',
      rowNumber: parsed.data.rowNumber,
      groupKey: null,
      action: 'skip_row',
      payload: {},
    })

    await logAuditEvent({
      action: 'update',
      entityType: 'import_session',
      entityId: parsed.data.importSessionId,
      summary: `Skipped row ${parsed.data.rowNumber} during WO import`,
    })

    revalidatePath('/maintenance/import')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 7. Clear an override (undo) ─────────────────────────────────────────

const ClearOverrideSchema = z
  .object({
    importSessionId: z.string().uuid(),
    rowNumber: z.number().int().min(1).optional(),
    groupKey: z.string().min(1).optional(),
  })
  .refine((v) => !!v.rowNumber !== !!v.groupKey, {
    message: 'Provide exactly one of rowNumber or groupKey.',
  })

export async function clearOverrideAction(
  input: z.infer<typeof ClearOverrideSchema>,
): Promise<FixResult> {
  try {
    const parsed = ClearOverrideSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role))
      return { success: false, error: 'Insufficient permissions.' }

    await loadOpenSession(supabase, tenantId, parsed.data.importSessionId)

    let q = supabase
      .from('import_overrides')
      .delete()
      .eq('import_session_id', parsed.data.importSessionId)
    if (parsed.data.rowNumber !== undefined) {
      q = q.eq('scope', 'row').eq('row_number', parsed.data.rowNumber)
    } else {
      q = q.eq('scope', 'group').eq('group_key', parsed.data.groupKey as string)
    }
    const { error } = await q
    if (error) return { success: false, error: error.message }

    revalidatePath('/maintenance/import')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ── 8. Asset search (for the inline picker) ─────────────────────────────

const SearchAssetsSchema = z.object({
  siteId: z.string().uuid(),
  query: z.string().max(100).optional().default(''),
  limit: z.number().int().min(1).max(25).optional().default(10),
})

export interface AssetSearchHit {
  id: string
  name: string
  asset_type: string | null
  maximo_id: string | null
  location: string | null
}

export async function searchAssetsAction(
  input: z.infer<typeof SearchAssetsSchema>,
): Promise<FixResult<AssetSearchHit[]>> {
  try {
    const parsed = SearchAssetsSchema.safeParse(input)
    if (!parsed.success)
      return { success: false, error: parsed.error.issues[0].message }

    const { supabase, tenantId } = await requireUser()

    let q = supabase
      .from('assets')
      .select('id, name, asset_type, maximo_id, location')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('site_id', parsed.data.siteId)
      .order('name', { ascending: true })
      .limit(parsed.data.limit)

    const query = parsed.data.query.trim()
    if (query) {
      // Escape PostgREST OR special chars (comma, parentheses) inside the
      // ilike patterns — Supabase's OR filter expects commas as separators.
      const safe = query.replace(/[,%()]/g, '\\$&')
      q = q.or(
        [
          `name.ilike.%${safe}%`,
          `maximo_id.ilike.%${safe}%`,
          `location.ilike.%${safe}%`,
        ].join(','),
      )
    }

    const { data, error } = await q
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as AssetSearchHit[] }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
