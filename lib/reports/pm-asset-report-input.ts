/**
 * buildPmAssetReportInput — gathers everything the PM Asset Report generator
 * needs for one maintenance check and returns a PmAssetReportInput.
 *
 * Extracted from app/api/pm-asset-report/route.ts (2026-06-06) so the same
 * input can be built outside the HTTP route — specifically the pre-visit tech
 * brief, which attaches the last-visit report to its email. The route still
 * owns auth + role gating + the HTTP response; this owns only data gathering.
 *
 * Returns null when the check doesn't exist for the tenant (route → 404).
 * Throws on hard fetch failures (route → 500; brief → skips the attachment).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import type {
  PmAssetReportInput,
  PmAssetSection,
  PmAssetTask,
  AcbTestSummary,
  NsxTestSummary,
  RcdTestSummary,
  AcbTestDetail,
  BreakerTestReading,
} from '@/lib/reports/pm-asset-report'
import { resolveReportLogos, fetchSitePhoto } from '@/lib/reports/logo-variants'
import { resolveBreakerIdentity, formatMakeModel, type BreakerIdentityRow } from '@/lib/reports/breaker-identity'

export type ReportComplexity = 'summary' | 'standard' | 'detailed'

export async function buildPmAssetReportInput(
  supabase: SupabaseClient,
  checkId: string,
  tenantId: string,
  complexityOverride: ReportComplexity | null,
): Promise<PmAssetReportInput | null> {
  // Fetch maintenance check with site + maintenance plan
  const { data: check } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name, code), sites(name, address)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) return null

  // Fetch site details for customer info + logo variants
  const { data: site } = await supabase
    .from('sites')
    .select('*, customers(name, logo_url, logo_url_on_dark)')
    .eq('id', check.site_id)
    .maybeSingle()

  // Fetch check_assets with related asset info
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location, job_plans(name, code))')
    .eq('check_id', checkId)
    .order('created_at')

  if (!checkAssets) throw new Error('Failed to fetch check assets')

  // Fetch ALL check items for this check in one query
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')

  if (!allItems) throw new Error('Failed to fetch check items')

  // Group items by check_asset_id
  const itemsByCheckAsset: Record<string, typeof allItems> = {}
  for (const item of allItems) {
    const caId = item.check_asset_id ?? '_unlinked'
    if (!itemsByCheckAsset[caId]) itemsByCheckAsset[caId] = []
    itemsByCheckAsset[caId].push(item)
  }

  // Fetch tenant settings for branding + report config via the cached helper.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  // Fetch tenant row for product-name fallback
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? tenantRow?.name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const complexity = complexityOverride ?? (tenantSettings?.report_complexity as ReportComplexity | null) ?? 'standard'

  const reportLogos = await resolveReportLogos(tenantSettings, tenantRow)
  const sitePhoto = check.site_id ? await fetchSitePhoto(supabase, check.site_id, tenantId) : undefined

  // Resolve user names (assigned_to + created_by + per-item completed_by).
  const userIds = new Set<string>()
  if (check.assigned_to) userIds.add(check.assigned_to)
  if ((check as { created_by?: string | null }).created_by) {
    userIds.add((check as { created_by: string }).created_by)
  }
  for (const item of allItems) {
    if (item.completed_by) userIds.add(item.completed_by)
  }

  const userMap: Record<string, string> = {}
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', Array.from(userIds))
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  // Count outstanding items
  const outstandingAssets = checkAssets.filter(ca => ca.status !== 'completed' && ca.status !== 'na').length
  const woCount = checkAssets.filter(ca => !!ca.work_order_number).length
  const outstandingWOs = woCount === 0 ? null : checkAssets.length - woCount

  // Linked test records — fetch ACB / NSX / RCD tests that point at this check.
  const [acbLinkedRes, nsxLinkedRes, rcdLinkedRes] = await Promise.all([
    supabase
      .from('acb_tests')
      .select('id, test_date, test_type, cb_make, cb_model, cb_serial, cb_rating, cb_poles, trip_unit, brand, breaker_type, current_in, trip_unit_model, performance_level, fixed_withdrawable, protection_unit_fitted, long_time_ir, long_time_delay_tr, short_time_pickup_isd, short_time_delay_tsd, instantaneous_pickup, earth_fault_pickup, earth_fault_delay, earth_leakage_pickup, earth_leakage_delay, motor_charge, shunt_trip_mx1, shunt_close_xf, undervoltage_mn, second_shunt_trip, step1_status, step2_status, step3_status, overall_result, assets(name)')
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('nsx_tests')
      .select('id, test_date, test_type, cb_make, cb_model, cb_serial, cb_rating, cb_poles, trip_unit, brand, breaker_type, current_in, trip_unit_model, fixed_withdrawable, long_time_ir, long_time_delay_tr, short_time_pickup_isd, short_time_delay_tsd, instantaneous_pickup, earth_fault_pickup, earth_fault_delay, step1_status, step2_status, step3_status, overall_result, assets(name)')
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('rcd_tests')
      .select('id, test_date, status, assets(name, jemena_asset_id)')
      .eq('check_id', checkId)
      .eq('is_active', true)
      .order('test_date', { ascending: false }),
  ])

  // Bulk-fetch readings for each test type. One round-trip per type.
  const acbIds = (acbLinkedRes.data ?? []).map((t) => t.id)
  const nsxIds = (nsxLinkedRes.data ?? []).map((t) => t.id)
  type ReadingRow = { acb_test_id?: string; nsx_test_id?: string; label: string; value: string; unit: string | null; is_pass: boolean | null; sort_order: number }
  const acbReadingsByTest = new Map<string, BreakerTestReading[]>()
  const nsxReadingsByTest = new Map<string, BreakerTestReading[]>()
  if (acbIds.length > 0) {
    const { data: rows } = await supabase
      .from('acb_test_readings')
      .select('acb_test_id, label, value, unit, is_pass, sort_order')
      .in('acb_test_id', acbIds)
      .order('sort_order')
    for (const r of (rows ?? []) as ReadingRow[]) {
      const arr = acbReadingsByTest.get(r.acb_test_id!) ?? []
      arr.push({ label: r.label, value: r.value, unit: r.unit, isPass: r.is_pass })
      acbReadingsByTest.set(r.acb_test_id!, arr)
    }
  }
  if (nsxIds.length > 0) {
    const { data: rows } = await supabase
      .from('nsx_test_readings')
      .select('nsx_test_id, label, value, unit, is_pass, sort_order')
      .in('nsx_test_id', nsxIds)
      .order('sort_order')
    for (const r of (rows ?? []) as ReadingRow[]) {
      const arr = nsxReadingsByTest.get(r.nsx_test_id!) ?? []
      arr.push({ label: r.label, value: r.value, unit: r.unit, isPass: r.is_pass })
      nsxReadingsByTest.set(r.nsx_test_id!, arr)
    }
  }

  type BreakerCols = BreakerIdentityRow & { id: string }
  type AcbStep1Cols = {
    protection_unit_fitted?: boolean | null
    long_time_ir?: string | null
    long_time_delay_tr?: string | null
    short_time_pickup_isd?: string | null
    short_time_delay_tsd?: string | null
    instantaneous_pickup?: string | null
    earth_fault_pickup?: string | null
    earth_fault_delay?: string | null
    earth_leakage_pickup?: string | null
    earth_leakage_delay?: string | null
    motor_charge?: string | null
    shunt_trip_mx1?: string | null
    shunt_close_xf?: string | null
    undervoltage_mn?: string | null
    second_shunt_trip?: string | null
  }

  function buildAcbDetail(t: typeof acbLinkedRes.data extends Array<infer U> | null ? U : never): AcbTestDetail {
    const r = t as unknown as BreakerCols & AcbStep1Cols
    return {
      ...resolveBreakerIdentity(r, { includePerformanceLevel: true }),
      readings: acbReadingsByTest.get(r.id) ?? [],
      protectionUnitFitted: r.protection_unit_fitted ?? null,
      longTimeIr: r.long_time_ir ?? null,
      longTimeDelayTr: r.long_time_delay_tr ?? null,
      shortTimePickupIsd: r.short_time_pickup_isd ?? null,
      shortTimeDelayTsd: r.short_time_delay_tsd ?? null,
      instantaneousPickup: r.instantaneous_pickup ?? null,
      earthFaultPickup: r.earth_fault_pickup ?? null,
      earthFaultDelay: r.earth_fault_delay ?? null,
      earthLeakagePickup: r.earth_leakage_pickup ?? null,
      earthLeakageDelay: r.earth_leakage_delay ?? null,
      motorCharge: r.motor_charge ?? null,
      shuntTripMx1: r.shunt_trip_mx1 ?? null,
      shuntCloseXf: r.shunt_close_xf ?? null,
      undervoltageMn: r.undervoltage_mn ?? null,
      secondShuntTrip: r.second_shunt_trip ?? null,
    }
  }

  type NsxStep1Cols = {
    long_time_ir?: string | null
    long_time_delay_tr?: string | null
    short_time_pickup_isd?: string | null
    short_time_delay_tsd?: string | null
    instantaneous_pickup?: string | null
    earth_fault_pickup?: string | null
    earth_fault_delay?: string | null
  }

  function buildNsxDetail(t: typeof nsxLinkedRes.data extends Array<infer U> | null ? U : never): AcbTestDetail {
    const r = t as unknown as BreakerCols & NsxStep1Cols
    return {
      ...resolveBreakerIdentity(r, { includePerformanceLevel: false }),
      readings: nsxReadingsByTest.get(r.id) ?? [],
      longTimeIr: r.long_time_ir ?? null,
      longTimeDelayTr: r.long_time_delay_tr ?? null,
      shortTimePickupIsd: r.short_time_pickup_isd ?? null,
      shortTimeDelayTsd: r.short_time_delay_tsd ?? null,
      instantaneousPickup: r.instantaneous_pickup ?? null,
      earthFaultPickup: r.earth_fault_pickup ?? null,
      earthFaultDelay: r.earth_fault_delay ?? null,
    }
  }

  function unwrap<T>(v: T | T[] | null): T | null {
    if (!v) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }
  function stepCount(t: { step1_status: string | null; step2_status: string | null; step3_status: string | null }): number {
    return (
      (t.step1_status === 'complete' ? 1 : 0) +
      (t.step2_status === 'complete' ? 1 : 0) +
      (t.step3_status === 'complete' ? 1 : 0)
    )
  }

  const acbSummaries: AcbTestSummary[] = (acbLinkedRes.data ?? []).map((t) => {
    const asset = unwrap(t.assets as { name: string } | { name: string }[] | null)
    return {
      assetName: asset?.name ?? '—',
      cbMakeModel: formatMakeModel(t as unknown as BreakerIdentityRow),
      testType: t.test_type ?? '—',
      testDate: t.test_date,
      stepsDone: stepCount(t),
      stepsTotal: 3,
      overallResult: (t.overall_result as 'Pass' | 'Fail' | 'Defect' | 'Pending') ?? 'Pending',
      detail: buildAcbDetail(t),
    }
  })

  const nsxSummaries: NsxTestSummary[] = (nsxLinkedRes.data ?? []).map((t) => {
    const asset = unwrap(t.assets as { name: string } | { name: string }[] | null)
    return {
      assetName: asset?.name ?? '—',
      cbMakeModel: formatMakeModel(t as unknown as BreakerIdentityRow),
      testType: t.test_type ?? '—',
      testDate: t.test_date,
      stepsDone: stepCount(t),
      stepsTotal: 3,
      overallResult: (t.overall_result as 'Pass' | 'Fail' | 'Defect' | 'Pending') ?? 'Pending',
      detail: buildNsxDetail(t),
    }
  })

  const rcdRows = rcdLinkedRes.data ?? []
  const rcdIds = rcdRows.map((r) => r.id)
  type CircuitRow = {
    rcd_test_id: string
    section_label: string | null
    circuit_no: string
    normal_trip_current_ma: number
    jemena_circuit_asset_id: string | null
    x1_no_trip_0_ms: string | null
    x1_no_trip_180_ms: string | null
    x1_trip_0_ms: string | null
    x1_trip_180_ms: string | null
    x5_fast_0_ms: string | null
    x5_fast_180_ms: string | null
    trip_test_button_ok: boolean
    is_critical_load: boolean
    action_taken: string | null
    sort_order: number
  }
  const circuitsByTest = new Map<string, CircuitRow[]>()
  if (rcdIds.length > 0) {
    const { data: circuitRows } = await supabase
      .from('rcd_test_circuits')
      .select(
        'rcd_test_id, section_label, circuit_no, normal_trip_current_ma, jemena_circuit_asset_id, x1_no_trip_0_ms, x1_no_trip_180_ms, x1_trip_0_ms, x1_trip_180_ms, x5_fast_0_ms, x5_fast_180_ms, trip_test_button_ok, is_critical_load, action_taken, sort_order',
      )
      .in('rcd_test_id', rcdIds)
      .order('sort_order')
    for (const c of (circuitRows ?? []) as CircuitRow[]) {
      const arr = circuitsByTest.get(c.rcd_test_id) ?? []
      arr.push(c)
      circuitsByTest.set(c.rcd_test_id, arr)
    }
  }

  const rcdSummaries: RcdTestSummary[] = rcdRows.map((t) => {
    const asset = unwrap(t.assets as { name: string; jemena_asset_id: string | null } | { name: string; jemena_asset_id: string | null }[] | null)
    const ckts = circuitsByTest.get(t.id) ?? []
    return {
      assetName: asset?.name ?? '—',
      jemenaAssetId: asset?.jemena_asset_id ?? null,
      testDate: t.test_date,
      circuitCount: ckts.length,
      status: (t.status as 'draft' | 'complete' | 'archived') ?? 'draft',
      circuits: ckts.length > 0
        ? ckts.map((c) => ({
            sectionLabel: c.section_label,
            circuitNo: c.circuit_no,
            normalTripCurrentMa: c.normal_trip_current_ma,
            jemenaCircuitAssetId: c.jemena_circuit_asset_id,
            x1NoTrip0Ms: c.x1_no_trip_0_ms,
            x1NoTrip180Ms: c.x1_no_trip_180_ms,
            x1Trip0Ms: c.x1_trip_0_ms,
            x1Trip180Ms: c.x1_trip_180_ms,
            x5Fast0Ms: c.x5_fast_0_ms,
            x5Fast180Ms: c.x5_fast_180_ms,
            tripTestButtonOk: c.trip_test_button_ok,
            isCriticalLoad: c.is_critical_load,
            actionTaken: c.action_taken,
          }))
        : undefined,
    }
  })

  // Build per-asset sections
  const assetSections: PmAssetSection[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_id: string | null; location: string | null; job_plans: { name: string; code: string | null } | null } | null
    const items = itemsByCheckAsset[ca.id] ?? []

    const failedItems = items.filter(i => i.result === 'fail' || i.result === 'no')
    const defectsFound = failedItems.length > 0
      ? failedItems.map(i => `${i.description}${i.notes ? ': ' + i.notes : ''}`).join('; ')
      : undefined

    const tasks: PmAssetTask[] = items.map((item, idx) => ({
      order: idx + 1,
      description: item.description,
      result: item.result as PmAssetTask['result'],
      notes: item.notes ?? undefined,
    }))

    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetId: asset?.maximo_id ?? ca.asset_id,
      site: site?.name ?? (check.sites as { name: string } | null)?.name ?? 'Unknown',
      location: asset?.location ?? '—',
      jobPlanName: asset?.job_plans?.name ?? (check.job_plans as { name: string } | null)?.name ?? '—',
      workOrderNumber: ca.work_order_number ?? null,
      priority: ca.priority ?? null,
      workType: ca.work_type ?? null,
      crewId: ca.crew_id ?? null,
      targetStart: ca.target_start ?? null,
      targetFinish: ca.target_finish ?? null,
      classification: ca.classification ?? null,
      irScanResult: ca.ir_scan_result ?? null,
      failureCode: ca.failure_code ?? null,
      problem: ca.problem ?? null,
      cause: ca.cause ?? null,
      remedy: ca.remedy ?? null,
      tasks,
      defectsFound,
      recommendedAction: failedItems.length > 0 ? 'Follow-up rectification required for failed items.' : undefined,
      technicianName: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : 'Unassigned',
      completedDate: ca.completed_at,
      notes: ca.notes ?? undefined,
    }
  })

  // Build the full report input
  const siteName = site?.name ?? (check.sites as { name: string } | null)?.name ?? 'Unknown Site'
  const customerName = (site?.customers as { name: string } | null)?.name ?? 'Unknown Customer'
  const jobPlanCode = (check.job_plans as { code: string | null } | null)?.code ?? ''
  const jobPlanName = (check.job_plans as { name: string } | null)?.name ?? ''
  const frequency = check.frequency?.replace('_', ' ') ?? ''

  const reportInput: PmAssetReportInput = {
    complexity,
    reportTitle: check.custom_name ?? `${siteName} - ${frequency} - ${jobPlanName}`,
    reportGeneratedDate: new Date().toISOString(),
    reportingPeriod: fmtPeriod(check.due_date ?? check.created_at),

    siteName,
    siteCode: jobPlanCode || siteName,
    siteAddress: site?.address ?? '—',
    customerName,
    supervisorName: (check as { created_by?: string | null }).created_by
      ? (userMap[(check as { created_by: string }).created_by] ?? '—')
      : '—',
    contactEmail: '—',
    contactPhone: '—',

    startDate: check.started_at ?? check.created_at,
    dueDate: check.due_date ?? '—',
    completedDate: check.completed_at,
    outstandingAssets,
    outstandingWorkOrders: outstandingWOs,

    technicianName: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : 'Unassigned',
    reviewerName: (check as { created_by?: string | null }).created_by
      ? (userMap[(check as { created_by: string }).created_by] ?? null)
      : null,

    tenantProductName: productName,
    primaryColour,

    logoImageOnLight: reportLogos.onLight,
    logoImageOnDark:  reportLogos.onDark,

    customerLogoOnLight: undefined,
    customerLogoOnDark:  undefined,

    sitePhoto,

    companyName: tenantSettings?.report_company_name ?? undefined,
    companyAddress: tenantSettings?.report_company_address ?? undefined,
    companyAbn: tenantSettings?.report_company_abn ?? undefined,
    companyPhone: tenantSettings?.report_company_phone ?? undefined,

    assets: assetSections,
    linkedTests:
      acbSummaries.length > 0 || nsxSummaries.length > 0 || rcdSummaries.length > 0
        ? {
            acb: acbSummaries.length > 0 ? acbSummaries : undefined,
            nsx: nsxSummaries.length > 0 ? nsxSummaries : undefined,
            rcd: rcdSummaries.length > 0 ? rcdSummaries : undefined,
          }
        : undefined,
    overallNotes: check.notes ?? undefined,

    showCoverPage: tenantSettings?.report_show_cover_page ?? true,
    showContents: tenantSettings?.report_show_contents ?? true,
    showExecutiveSummary: tenantSettings?.report_show_executive_summary ?? true,
    showSignOff: tenantSettings?.report_show_sign_off ?? true,
    customHeaderText: tenantSettings?.report_header_text ?? undefined,
    customFooterText: tenantSettings?.report_footer_text ?? undefined,
    signOffFields: (tenantSettings?.report_sign_off_fields as string[] | null) ?? undefined,
  }

  return reportInput
}

// Helper: format a date string into "Month YYYY" for the reporting period
function fmtPeriod(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']
    return `${months[d.getMonth()]} ${d.getFullYear()}`
  } catch {
    return dateStr
  }
}
