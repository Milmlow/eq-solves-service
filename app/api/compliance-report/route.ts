/**
 * GET /api/compliance-report?customer_id=&site_id=&from=&to=&complexity=standard
 *
 * Generates a Compliance Dashboard Report DOCX.
 * Filters by customer, site, and date range.
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/api/auth'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { generateComplianceReport } from '@/lib/reports/compliance-report'
import type { ComplianceReportInput } from '@/lib/reports/compliance-report'
import { canWrite } from '@/lib/utils/roles'
import { computeMaintenanceCompliance, computeComplianceBySite } from '@/lib/analytics/site-health'
import { captureSlowReportRun } from '@/lib/observability/report-duration-canary'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function appDataFrom(supabase: any, table: string) { return supabase.schema('app_data').from(table) }

// Pulls 7 separate .limit(10000) tables and synthesises a multi-section
// DOCX. Detailed complexity at Jemena-scale crosses 15s. Set the runtime
// hint so Netlify doesn't cut us off at the default. Actual cap is the
// Netlify plan limit.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  // Wrap the whole handler so any thrown error surfaces as a JSON
  // response with a useful message instead of an HTML 500 — which the
  // client sees as the opaque "Download failed" alert (fix for Item 3
  // of Simon's 2026-04 feedback: "Compliance Report Detailed — download
  // fails with no diagnosable error"). The detailed complexity was the
  // reported failure but any query-time exception hit the same generic
  // alert, so hardening the whole path is worth more than chasing a
  // single branch we can't reproduce locally.
  try {
  const { searchParams } = request.nextUrl
  const customerId = searchParams.get('customer_id') ?? ''
  const siteId = searchParams.get('site_id') ?? ''
  const fromDate = searchParams.get('from') ?? ''
  const toDate = searchParams.get('to') ?? ''
  const complexityParam = searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const complexity = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : 'standard'

  const { user, tenantId, role, supabase } = await getApiUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canWrite(role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Fetch tenant settings for branding. tenants.name is the canonical
  // company name; tenant_settings overrides allow custom report-only
  // branding (e.g. trading name for invoicing different from legal name).
  // tenants.primary_colour does NOT exist (colour lives on tenant_settings).
  // The previous `, primary_colour` select silently returned the row without
  // the column rather than erroring, and the tenant?.primary_colour fallback
  // below was always undefined. Select only `name` here.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  const reportCompanyName = tenantSettings?.report_company_name ?? 'EQ Solves'
  const reportCompanyAbn = tenantSettings?.report_company_abn ?? null
  const productName = tenantSettings?.product_name ?? 'EQ Solves Service'
  const reportPrimaryColour = (tenantSettings?.primary_colour ?? '3DA8D8').replace('#', '')
  const reportDeepColour = tenantSettings?.deep_colour ?? null
  const reportIceColour = tenantSettings?.ice_colour ?? null
  const reportInkColour = tenantSettings?.ink_colour ?? null

  // Sites for name lookup and customer filtering
  const { data: sites } = await appDataFrom(supabase, 'sites')
    .select('site_id, name, customer_id')
    .eq('active', true)
    .eq('tenant_id', tenantId)
    .limit(10000)

  const siteMap = Object.fromEntries((sites ?? []).map((s: { site_id: string; name: string }) => [s.site_id, s.name]))

  // If customer selected, filter to their site IDs
  const customerSiteIds = customerId
    ? (sites ?? []).filter((s: { customer_id: string }) => s.customer_id === customerId).map((s: { site_id: string }) => s.site_id)
    : null

  // Build filter description
  let customerName = ''
  if (customerId) {
    const { data: cust } = await appDataFrom(supabase, 'customers').select('company_name').eq('customer_id', customerId).maybeSingle()
    customerName = (cust as { company_name?: string } | null)?.company_name ?? ''
  }
  const selectedSite = siteId ? siteMap[siteId] ?? '' : ''
  const filterParts = [
    customerName || null,
    selectedSite || null,
    fromDate ? `from ${fromDate}` : null,
    toDate ? `to ${toDate}` : null,
  ].filter(Boolean)
  const filterDescription = filterParts.length > 0 ? filterParts.join(' — ') : 'All data'

  // ── Maintenance checks ──
  let mCheckQuery = appDataFrom(supabase, 'maintenance_checks').select('id, status, due_date, completed_at, site_id').eq('tenant_id', tenantId).eq('active', true).limit(10000)
  if (siteId) {
    mCheckQuery = mCheckQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    mCheckQuery = mCheckQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) mCheckQuery = mCheckQuery.gte('due_date', fromDate)
  if (toDate) mCheckQuery = mCheckQuery.lte('due_date', toDate)
  const { data: checks } = await mCheckQuery

  // checks.status is string at DB level; computeMaintenanceCompliance narrows
  // to CheckStatus. Runtime tolerates unknown statuses; cast to bridge types.
  const maintenance = computeMaintenanceCompliance(checks as Parameters<typeof computeMaintenanceCompliance>[0])

  // ── Test records ──
  let tRecordQuery = appDataFrom(supabase, 'test_records').select('id, result, test_date, site_id').eq('active', true).limit(10000)
  if (siteId) {
    tRecordQuery = tRecordQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    tRecordQuery = tRecordQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) tRecordQuery = tRecordQuery.gte('test_date', fromDate)
  if (toDate) tRecordQuery = tRecordQuery.lte('test_date', toDate)
  const { data: tests } = await tRecordQuery

  const tTotal = tests?.length ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tPass = tests?.filter((t: any) => t.result === 'pass').length ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tFail = tests?.filter((t: any) => t.result === 'fail').length ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tDefect = tests?.filter((t: any) => t.result === 'defect').length ?? 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tPending = tests?.filter((t: any) => t.result === 'pending').length ?? 0
  const tPassRate = tTotal > 0 ? Math.round((tPass / tTotal) * 100) : 0

  // ── ACB / NSX progress ──
  let acbQuery = appDataFrom(supabase, 'acb_tests').select('id, step1_status, step2_status, step3_status').eq('active', true).limit(10000)
  if (siteId) acbQuery = acbQuery.eq('site_id', siteId)
  else if (customerSiteIds) acbQuery = acbQuery.in('site_id', customerSiteIds)
  if (fromDate) acbQuery = acbQuery.gte('test_date', fromDate)
  if (toDate) acbQuery = acbQuery.lte('test_date', toDate)
  const { data: acbTests } = await acbQuery

  let nsxQuery = appDataFrom(supabase, 'nsx_tests').select('id, step1_status, step2_status, step3_status').eq('active', true).limit(10000)
  if (siteId) nsxQuery = nsxQuery.eq('site_id', siteId)
  else if (customerSiteIds) nsxQuery = nsxQuery.in('site_id', customerSiteIds)
  if (fromDate) nsxQuery = nsxQuery.gte('test_date', fromDate)
  if (toDate) nsxQuery = nsxQuery.lte('test_date', toDate)
  const { data: nsxTests } = await nsxQuery

  function countProgress(rows: { step1_status: string; step2_status: string; step3_status: string }[] | null) {
    const out = { total: 0, complete: 0, inProgress: 0, notStarted: 0 }
    for (const r of rows ?? []) {
      out.total++
      const done = (r.step1_status === 'complete' ? 1 : 0) + (r.step2_status === 'complete' ? 1 : 0) + (r.step3_status === 'complete' ? 1 : 0)
      if (done === 3) out.complete++
      else if (done === 0) out.notStarted++
      else out.inProgress++
    }
    return out
  }

  // ── Defects ──
  let defectQuery = appDataFrom(supabase, 'defects').select('id, severity, status, site_id').limit(10000)
  if (siteId) defectQuery = defectQuery.eq('site_id', siteId)
  else if (customerSiteIds) defectQuery = defectQuery.in('site_id', customerSiteIds)
  if (fromDate) defectQuery = defectQuery.gte('created_at', fromDate)
  if (toDate) defectQuery = defectQuery.lte('created_at', toDate)
  const { data: defects } = await defectQuery

  // ── Compliance by site ──
  // Same cast rationale as computeMaintenanceCompliance above.
  const complianceBySite = computeComplianceBySite(
    checks as Parameters<typeof computeComplianceBySite>[0],
    siteMap,
    10,
  ).map((r) => ({
    site: r.siteName,
    total: r.total,
    complete: r.complete,
    overdue: r.overdue,
    rate: r.rate,
  }))

  // ── 6-month trend ──
  const now = new Date()
  const months: { key: string; label: string; tests: number; pass: number; checks: number; complete: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    months.push({
      key,
      label: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      tests: 0, pass: 0, checks: 0, complete: 0,
    })
  }
  const monthIdx = (date: string | null | undefined) => {
    if (!date) return -1
    const d = new Date(date)
    if (Number.isNaN(d.getTime())) return -1
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return months.findIndex((m) => m.key === key)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (tests ?? []) as any[]) {
    const idx = monthIdx(t.test_date)
    if (idx >= 0) { months[idx].tests++; if (t.result === 'pass') months[idx].pass++ }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (checks ?? []) as any[]) {
    if (!c.due_date) continue
    const idx = monthIdx(c.due_date)
    if (idx >= 0) { months[idx].checks++; if (c.status === 'complete') months[idx].complete++ }
  }

  // ── Generate report ──
  const input: ComplianceReportInput = {
    filterDescription,
    generatedDate: new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }),
    tenantProductName: productName,
    companyName: reportCompanyName,
    companyAbn: reportCompanyAbn,
    primaryColour: reportPrimaryColour,
    deepColour: reportDeepColour,
    iceColour: reportIceColour,
    inkColour: reportInkColour,
    complexity,
    maintenance,
    testing: { total: tTotal, pass: tPass, fail: tFail, defect: tDefect, pending: tPending, passRate: tPassRate },
    // DB step_status columns are nullable; countProgress treats null as
    // "not started" at runtime. Cast to bridge.
    acb: countProgress(acbTests as Parameters<typeof countProgress>[0]),
    nsx: countProgress(nsxTests as Parameters<typeof countProgress>[0]),
    defects: {
      total: defects?.length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      open: defects?.filter((d: any) => d.status === 'open').length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inProgress: defects?.filter((d: any) => d.status === 'in_progress').length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolved: defects?.filter((d: any) => d.status === 'resolved' || d.status === 'closed').length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      critical: defects?.filter((d: any) => d.severity === 'critical').length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      high: defects?.filter((d: any) => d.severity === 'high').length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      medium: defects?.filter((d: any) => d.severity === 'medium').length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      low: defects?.filter((d: any) => d.severity === 'low').length ?? 0,
    },
    complianceBySite,
    months: months.map((m) => ({ label: m.label, tests: m.tests, pass: m.pass, checks: m.checks, complete: m.complete })),
  }

  const buffer = await generateComplianceReport(input)
  const filename = `Compliance Report - ${filterDescription.replace(/[^a-zA-Z0-9 —-]/g, '').trim()}.docx`

  captureSlowReportRun({
    route: 'GET /api/compliance-report',
    durationMs: Date.now() - startedAt,
    status: 200,
    scale: {
      complexity,
      customerScoped: customerId ? 1 : 0,
      siteScoped: siteId ? 1 : 0,
      months: input.months.length,
    },
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
  } catch (err) {
    // Log the real error server-side (Netlify function logs) and surface
    // a diagnostic message to the client. Previously any thrown error
    // turned into an HTML 500, the client's `res.json()` blew up, and
    // the fallback "Download failed" alert left us with nothing to fix.
    const message = err instanceof Error ? err.message : 'Unknown error generating compliance report'
    console.error('[compliance-report] generation failed:', err)
    captureSlowReportRun({
      route: 'GET /api/compliance-report',
      durationMs: Date.now() - startedAt,
      status: 500,
      scale: { errored: 1 },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
