/**
 * GET /api/compliance-report?customer_id=&site_id=&from=&to=&complexity=standard
 *
 * Generates a Compliance Dashboard Report DOCX.
 * Filters by customer, site, and date range.
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateComplianceReport } from '@/lib/reports/compliance-report'
import type { ComplianceReportInput } from '@/lib/reports/compliance-report'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import { computeMaintenanceCompliance, computeComplianceBySite } from '@/lib/analytics/site-health'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const customerId = searchParams.get('customer_id') ?? ''
  const siteId = searchParams.get('site_id') ?? ''
  const fromDate = searchParams.get('from') ?? ''
  const toDate = searchParams.get('to') ?? ''
  const complexityParam = searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const complexity = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : 'standard'

  const supabase = await createClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership || !canWrite(membership.role as Role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const tenantId = membership.tenant_id

  // Fetch tenant settings for branding
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, primary_colour')
    .eq('id', tenantId)
    .maybeSingle()

  // Sites for name lookup and customer filtering
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, customer_id')
    .eq('is_active', true)
    .eq('tenant_id', tenantId)
    .limit(10000)

  const siteMap = Object.fromEntries((sites ?? []).map((s) => [s.id, s.name]))

  // If customer selected, filter to their site IDs
  const customerSiteIds = customerId
    ? (sites ?? []).filter((s) => s.customer_id === customerId).map((s) => s.id)
    : null

  // Build filter description
  let customerName = ''
  if (customerId) {
    const { data: cust } = await supabase.from('customers').select('name').eq('id', customerId).maybeSingle()
    customerName = cust?.name ?? ''
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
  let mCheckQuery = supabase.from('maintenance_checks').select('id, status, due_date, completed_at, site_id').eq('tenant_id', tenantId).eq('is_active', true).limit(10000)
  if (siteId) {
    mCheckQuery = mCheckQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    mCheckQuery = mCheckQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) mCheckQuery = mCheckQuery.gte('due_date', fromDate)
  if (toDate) mCheckQuery = mCheckQuery.lte('due_date', toDate)
  const { data: checks } = await mCheckQuery

  const maintenance = computeMaintenanceCompliance(checks)

  // ── Test records ──
  let tRecordQuery = supabase.from('test_records').select('id, result, test_date, site_id').eq('is_active', true).limit(10000)
  if (siteId) {
    tRecordQuery = tRecordQuery.eq('site_id', siteId)
  } else if (customerSiteIds) {
    tRecordQuery = tRecordQuery.in('site_id', customerSiteIds)
  }
  if (fromDate) tRecordQuery = tRecordQuery.gte('test_date', fromDate)
  if (toDate) tRecordQuery = tRecordQuery.lte('test_date', toDate)
  const { data: tests } = await tRecordQuery

  const tTotal = tests?.length ?? 0
  const tPass = tests?.filter((t) => t.result === 'pass').length ?? 0
  const tFail = tests?.filter((t) => t.result === 'fail').length ?? 0
  const tDefect = tests?.filter((t) => t.result === 'defect').length ?? 0
  const tPending = tests?.filter((t) => t.result === 'pending').length ?? 0
  const tPassRate = tTotal > 0 ? Math.round((tPass / tTotal) * 100) : 0

  // ── ACB / NSX progress ──
  let acbQuery = supabase.from('acb_tests').select('id, step1_status, step2_status, step3_status').eq('is_active', true).limit(10000)
  if (siteId) acbQuery = acbQuery.eq('site_id', siteId)
  else if (customerSiteIds) acbQuery = acbQuery.in('site_id', customerSiteIds)
  if (fromDate) acbQuery = acbQuery.gte('test_date', fromDate)
  if (toDate) acbQuery = acbQuery.lte('test_date', toDate)
  const { data: acbTests } = await acbQuery

  let nsxQuery = supabase.from('nsx_tests').select('id, step1_status, step2_status, step3_status').eq('is_active', true).limit(10000)
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
  let defectQuery = supabase.from('defects').select('id, severity, status, site_id').limit(10000)
  if (siteId) defectQuery = defectQuery.eq('site_id', siteId)
  else if (customerSiteIds) defectQuery = defectQuery.in('site_id', customerSiteIds)
  if (fromDate) defectQuery = defectQuery.gte('created_at', fromDate)
  if (toDate) defectQuery = defectQuery.lte('created_at', toDate)
  const { data: defects } = await defectQuery

  // ── Compliance by site ──
  const complianceBySite = computeComplianceBySite(checks, siteMap, 10).map((r) => ({
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
  const monthIdx = (date: string) => {
    const d = new Date(date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return months.findIndex((m) => m.key === key)
  }
  for (const t of tests ?? []) {
    const idx = monthIdx(t.test_date)
    if (idx >= 0) { months[idx].tests++; if (t.result === 'pass') months[idx].pass++ }
  }
  for (const c of checks ?? []) {
    if (!c.due_date) continue
    const idx = monthIdx(c.due_date)
    if (idx >= 0) { months[idx].checks++; if (c.status === 'complete') months[idx].complete++ }
  }

  // ── Generate report ──
  const input: ComplianceReportInput = {
    filterDescription,
    generatedDate: new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }),
    tenantProductName: tenant?.name ?? 'EQ Solves',
    primaryColour: (tenant?.primary_colour ?? '3DA8D8').replace('#', ''),
    complexity,
    maintenance,
    testing: { total: tTotal, pass: tPass, fail: tFail, defect: tDefect, pending: tPending, passRate: tPassRate },
    acb: countProgress(acbTests),
    nsx: countProgress(nsxTests),
    defects: {
      total: defects?.length ?? 0,
      open: defects?.filter((d) => d.status === 'open').length ?? 0,
      inProgress: defects?.filter((d) => d.status === 'in_progress').length ?? 0,
      resolved: defects?.filter((d) => d.status === 'resolved' || d.status === 'closed').length ?? 0,
      critical: defects?.filter((d) => d.severity === 'critical').length ?? 0,
      high: defects?.filter((d) => d.severity === 'high').length ?? 0,
      medium: defects?.filter((d) => d.severity === 'medium').length ?? 0,
      low: defects?.filter((d) => d.severity === 'low').length ?? 0,
    },
    complianceBySite,
    months: months.map((m) => ({ label: m.label, tests: m.tests, pass: m.pass, checks: m.checks, complete: m.complete })),
  }

  const buffer = await generateComplianceReport(input)
  const filename = `Compliance Report - ${filterDescription.replace(/[^a-zA-Z0-9 —-]/g, '').trim()}.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
