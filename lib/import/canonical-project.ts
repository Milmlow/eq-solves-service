/**
 * Pure projection helpers for the admin Delta importer.
 *
 * `projectMaintenanceCheck` and `projectCheckAsset` reshape resolved
 * import inputs (siteId, jobPlanId, parsed row) into the canonical
 * maintenance_check and check_asset shapes — the same shape that
 * `/api/admin/export` emits via `lib/admin/canonical-export.ts`.
 *
 * `toDbMaintenanceCheckInsert` and `toDbCheckAssetInsert` then translate
 * those canonical objects back into the DB-column shape used by `INSERT`
 * statements.  Keeping the two halves explicit lets the round-trip smoke
 * test ajv-validate the canonical projection, hand it to the DB writer,
 * and verify the exporter would emit the same canonical object back.
 *
 * No DB access. No ajv. No side effects.
 */

import type { Database } from '@/lib/supabase/database.types'
import type { DeltaRow, FrequencyEnum, ParsedGroup } from './delta-wo-parser'

type MaintenanceCheckInsert = Database['public']['Tables']['maintenance_checks']['Insert']
type CheckAssetInsert = Database['public']['Tables']['check_assets']['Insert']

// ── Canonical types — mirror the v1 schemas in lib/import/schemas/ ────

/** Shape of a maintenance_check object — matches the canonical schema. */
export interface CanonicalMaintenanceCheck {
  check_id: string
  tenant_id: string
  plan_id: string | null
  site_id: string
  assigned_to_user_id: string | null
  status: 'scheduled' | 'in_progress' | 'complete' | 'overdue' | 'cancelled'
  due_date: string
  start_date: string | null
  started_at: string | null
  completed_at: string | null
  frequency: FrequencyEnum | null
  is_dark_site: boolean
  custom_name: string | null
  maximo_wo_number: string | null
  maximo_pm_number: string | null
  notes: string | null
}

/** Shape of a check_asset object — matches the canonical schema. */
export interface CanonicalCheckAsset {
  check_asset_id: string
  tenant_id: string
  check_id: string
  asset_id: string
  status: 'pending' | 'in_progress' | 'complete' | 'skipped' | 'failed'
  work_order_number: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent' | null
  work_type: 'PM' | 'CM' | 'EM' | 'CAL' | 'INSP' | null
  crew_id: string | null
  target_start: string | null
  target_finish: string | null
  completed_at: string | null
  failure_code: string | null
  problem: string | null
  cause: string | null
  remedy: string | null
  classification: string | null
  ir_scan_result: 'pass' | 'fail' | 'na' | 'not_done' | null
  notes: string | null
}

// ── Enum normalisers ──────────────────────────────────────────────────

const PRIORITY_MAP: Record<string, CanonicalCheckAsset['priority']> = {
  low: 'low', l: 'low', '4': 'low', p4: 'low', low_priority: 'low',
  medium: 'medium', m: 'medium', med: 'medium', '3': 'medium', p3: 'medium', normal: 'medium',
  high: 'high', h: 'high', '2': 'high', p2: 'high',
  urgent: 'urgent', u: 'urgent', '1': 'urgent', p1: 'urgent', critical: 'urgent',
}

const WORK_TYPE_MAP: Record<string, CanonicalCheckAsset['work_type']> = {
  pm: 'PM', preventive: 'PM', preventative: 'PM', preventive_maintenance: 'PM',
  cm: 'CM', corrective: 'CM', corrective_maintenance: 'CM',
  em: 'EM', emergency: 'EM', emergency_maintenance: 'EM',
  cal: 'CAL', calibration: 'CAL', calibrate: 'CAL',
  insp: 'INSP', inspection: 'INSP', inspect: 'INSP',
}

const IR_SCAN_MAP: Record<string, CanonicalCheckAsset['ir_scan_result']> = {
  pass: 'pass', p: 'pass', ok: 'pass', passed: 'pass', green: 'pass',
  fail: 'fail', f: 'fail', failed: 'fail', red: 'fail',
  na: 'na', 'n/a': 'na', not_applicable: 'na',
  not_done: 'not_done', pending: 'not_done', skipped: 'not_done', incomplete: 'not_done',
}

function normalisePriority(raw: string | null): CanonicalCheckAsset['priority'] {
  if (!raw) return null
  return PRIORITY_MAP[raw.trim().toLowerCase()] ?? null
}

function normaliseWorkType(raw: string | null): CanonicalCheckAsset['work_type'] {
  if (!raw) return null
  return WORK_TYPE_MAP[raw.trim().toLowerCase()] ?? null
}

function normaliseIrScan(raw: string | null): CanonicalCheckAsset['ir_scan_result'] {
  if (!raw) return null
  return IR_SCAN_MAP[raw.trim().toLowerCase()] ?? null
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function isoDateTime(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

// ── Projections ───────────────────────────────────────────────────────

export interface MaintenanceCheckProjectionInput {
  /** Pre-generated UUID for this check. Caller must supply. */
  checkId: string
  tenantId: string
  group: ParsedGroup
  siteId: string
  jobPlanId: string | null
  customName: string | null
  assignedToUserId: string | null
}

export function projectMaintenanceCheck(
  input: MaintenanceCheckProjectionInput,
): CanonicalMaintenanceCheck {
  const startIso = isoDate(input.group.startDate) ?? ''
  return {
    check_id: input.checkId,
    tenant_id: input.tenantId,
    plan_id: input.jobPlanId,
    site_id: input.siteId,
    assigned_to_user_id: input.assignedToUserId,
    status: 'scheduled',
    due_date: startIso,
    start_date: startIso || null,
    started_at: null,
    completed_at: null,
    frequency: input.group.frequency,
    is_dark_site: false,
    custom_name: input.customName,
    // Parent check carries no single WO number — WOs live on check_assets.
    maximo_wo_number: null,
    maximo_pm_number: null,
    notes: null,
  }
}

export interface CheckAssetProjectionInput {
  /** Pre-generated UUID for this check_asset. */
  checkAssetId: string
  tenantId: string
  checkId: string
  assetId: string
  row: DeltaRow
}

export function projectCheckAsset(
  input: CheckAssetProjectionInput,
): CanonicalCheckAsset {
  const r = input.row
  return {
    check_asset_id: input.checkAssetId,
    tenant_id: input.tenantId,
    check_id: input.checkId,
    asset_id: input.assetId,
    status: 'pending',
    work_order_number: r.workOrder || null,
    priority: normalisePriority(r.priority),
    work_type: normaliseWorkType(r.workType),
    crew_id: r.crewId,
    target_start: isoDateTime(r.targetStart),
    target_finish: isoDateTime(r.targetFinish),
    completed_at: null,
    failure_code: r.failureCode,
    problem: r.problem,
    cause: r.cause,
    remedy: r.remedy,
    classification: r.classification,
    ir_scan_result: normaliseIrScan(r.irScanResult),
    notes: null,
  }
}

// ── DB inserts ────────────────────────────────────────────────────────

/**
 * Translate a canonical maintenance_check to the column shape the DB
 * `maintenance_checks` table expects on INSERT.
 *
 * Field-name renames are reversed (plan_id → job_plan_id,
 * assigned_to_user_id → assigned_to) so the exporter pulls back the same
 * canonical object. Date strings pass through unchanged.
 */
export function toDbMaintenanceCheckInsert(c: CanonicalMaintenanceCheck): MaintenanceCheckInsert {
  return {
    id: c.check_id,
    tenant_id: c.tenant_id,
    job_plan_id: c.plan_id,
    site_id: c.site_id,
    assigned_to: c.assigned_to_user_id,
    status: c.status,
    due_date: c.due_date,
    start_date: c.start_date,
    started_at: c.started_at,
    completed_at: c.completed_at,
    frequency: c.frequency,
    is_dark_site: c.is_dark_site,
    custom_name: c.custom_name,
    maximo_wo_number: c.maximo_wo_number,
    maximo_pm_number: c.maximo_pm_number,
    notes: c.notes,
  }
}

export function toDbCheckAssetInsert(c: CanonicalCheckAsset): CheckAssetInsert {
  return {
    id: c.check_asset_id,
    tenant_id: c.tenant_id,
    check_id: c.check_id,
    asset_id: c.asset_id,
    status: c.status,
    work_order_number: c.work_order_number,
    priority: c.priority,
    work_type: c.work_type,
    crew_id: c.crew_id,
    target_start: c.target_start,
    target_finish: c.target_finish,
    completed_at: c.completed_at,
    failure_code: c.failure_code,
    problem: c.problem,
    cause: c.cause,
    remedy: c.remedy,
    classification: c.classification,
    ir_scan_result: c.ir_scan_result,
    notes: c.notes,
  }
}
