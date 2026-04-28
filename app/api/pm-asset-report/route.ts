/**
 * GET /api/pm-asset-report?check_id=xxx
 *
 * Generates and returns a professional PM Asset Report (DOCX) for the given
 * maintenance check. Includes cover page, site overview, executive summary,
 * per-asset sections with task checklists, and sign-off page.
 *
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePMAssetReport } from '@/lib/reports/pm-asset-report'
import type {
  PmAssetReportInput,
  PmAssetSection,
  PmAssetTask,
  AcbTestSummary,
  NsxTestSummary,
  RcdTestSummary,
} from '@/lib/reports/pm-asset-report'
import {
  resolveReportLogos,
  resolveCustomerLogos,
  fetchSitePhoto,
} from '@/lib/reports/logo-variants'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'

export async function GET(request: NextRequest) {
  const checkId = request.nextUrl.searchParams.get('check_id')
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

  // Complexity override — falls back to tenant default if not provided
  const complexityParam = request.nextUrl.searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const complexityOverride = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : null

  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role check — supervisor+ to generate reports
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

  // Fetch maintenance check with site + job plan
  const { data: check } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name, code), sites(name, address)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

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

  if (!checkAssets) {
    return NextResponse.json({ error: 'Failed to fetch check assets' }, { status: 500 })
  }

  // Fetch ALL check items for this check in one query
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')

  if (!allItems) {
    return NextResponse.json({ error: 'Failed to fetch check items' }, { status: 500 })
  }

  // Group items by check_asset_id
  const itemsByCheckAsset: Record<string, typeof allItems> = {}
  for (const item of allItems) {
    const caId = item.check_asset_id ?? '_unlinked'
    if (!itemsByCheckAsset[caId]) itemsByCheckAsset[caId] = []
    itemsByCheckAsset[caId].push(item)
  }

  // Fetch tenant settings for branding + report config
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('product_name, primary_colour, logo_url, logo_url_on_dark, report_logo_url, report_logo_url_on_dark, report_complexity, report_show_cover_page, report_show_contents, report_show_executive_summary, report_show_sign_off, report_header_text, report_footer_text, report_company_name, report_company_address, report_company_abn, report_company_phone, report_sign_off_fields')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  // Fetch tenant row for product-name fallback
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? tenantRow?.name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const complexity = complexityOverride ?? (tenantSettings?.report_complexity as 'summary' | 'standard' | 'detailed' | null) ?? 'standard'

  // Resolve tenant + customer logos for both surfaces — see lib/reports/logo-variants
  const reportLogos = await resolveReportLogos(tenantSettings, tenantRow)
  const customerRow = site?.customers as { name: string; logo_url?: string | null; logo_url_on_dark?: string | null } | null
  const customerLogos = await resolveCustomerLogos(customerRow, { width: 140, height: 48 })
  const sitePhoto = check.site_id ? await fetchSitePhoto(supabase, check.site_id, tenantId) : undefined

  // Resolve user names (assigned_to, completed_by, etc.)
  const userIds = new Set<string>()
  if (check.assigned_to) userIds.add(check.assigned_to)
  if (check.completed_by) userIds.add(check.completed_by)
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
  const outstandingWOs = checkAssets.filter(ca => !ca.work_order_number).length

  // Phase 5: Linked test records — fetch ACB / NSX / RCD tests that point
  // at this maintenance_check, summarise to one row per asset, and pass
  // through to the report builder. Renders a Test Records section in the
  // PDF when any kind has rows; silently absent for plain PPM checks.
  const [acbLinkedRes, nsxLinkedRes, rcdLinkedRes] = await Promise.all([
    supabase
      .from('acb_tests')
      .select(
        'id, test_date, test_type, cb_make, cb_model, step1_status, step2_status, step3_status, overall_result, assets(name)',
      )
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('nsx_tests')
      .select(
        'id, test_date, test_type, cb_make, cb_model, step1_status, step2_status, step3_status, overall_result, assets(name)',
      )
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('rcd_tests')
      .select('id, test_date, status, assets(name, jemena_asset_id)')
      .eq('check_id', checkId)
      .eq('is_active', true)
      .order('test_date', { ascending: false }),
  ])

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
      cbMakeModel: [t.cb_make, t.cb_model].filter(Boolean).join(' ') || '—',
      testType: t.test_type ?? '—',
      testDate: t.test_date,
      stepsDone: stepCount(t),
      stepsTotal: 3,
      overallResult: (t.overall_result as 'Pass' | 'Fail' | 'Defect' | 'Pending') ?? 'Pending',
    }
  })

  const nsxSummaries: NsxTestSummary[] = (nsxLinkedRes.data ?? []).map((t) => {
    const asset = unwrap(t.assets as { name: string } | { name: string }[] | null)
    return {
      assetName: asset?.name ?? '—',
      cbMakeModel: [t.cb_make, t.cb_model].filter(Boolean).join(' ') || '—',
      testType: t.test_type ?? '—',
      testDate: t.test_date,
      stepsDone: stepCount(t),
      stepsTotal: 3,
      overallResult: (t.overall_result as 'Pass' | 'Fail' | 'Defect' | 'Pending') ?? 'Pending',
    }
  })

  // RCD circuit counts come from a separate query — bulk lookup keyed by test id.
  const rcdRows = rcdLinkedRes.data ?? []
  const rcdIds = rcdRows.map((r) => r.id)
  const circuitCountByTest = new Map<string, number>()
  if (rcdIds.length > 0) {
    const { data: circuitRows } = await supabase
      .from('rcd_test_circuits')
      .select('rcd_test_id')
      .in('rcd_test_id', rcdIds)
    for (const c of circuitRows ?? []) {
      circuitCountByTest.set(c.rcd_test_id, (circuitCountByTest.get(c.rcd_test_id) ?? 0) + 1)
    }
  }

  const rcdSummaries: RcdTestSummary[] = rcdRows.map((t) => {
    const asset = unwrap(t.assets as { name: string; jemena_asset_id: string | null } | { name: string; jemena_asset_id: string | null }[] | null)
    return {
      assetName: asset?.name ?? '—',
      jemenaAssetId: asset?.jemena_asset_id ?? null,
      testDate: t.test_date,
      circuitCount: circuitCountByTest.get(t.id) ?? 0,
      status: (t.status as 'draft' | 'complete' | 'archived') ?? 'draft',
    }
  })

  // Build per-asset sections
  const assetSections: PmAssetSection[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_id: string | null; location: string | null; job_plans: { name: string; code: string | null } | null } | null
    const items = itemsByCheckAsset[ca.id] ?? []

    // Detect defects: items with result = 'fail'
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
    supervisorName: check.completed_by ? (userMap[check.completed_by] ?? '—') : '—',
    contactEmail: '—',
    contactPhone: '—',

    startDate: check.started_at ?? check.created_at,
    dueDate: check.due_date ?? '—',
    completedDate: check.completed_at,
    outstandingAssets,
    outstandingWorkOrders: outstandingWOs,

    technicianName: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : 'Unassigned',
    reviewerName: check.completed_by ? (userMap[check.completed_by] ?? null) : null,

    tenantProductName: productName,
    primaryColour,

    // Tenant / report logo variants (light + dark surface)
    logoImageOnLight: reportLogos.onLight,
    logoImageOnDark:  reportLogos.onDark,

    // Customer logo variants (cover page "Prepared for" lockup)
    customerLogoOnLight: customerLogos.onLight,
    customerLogoOnDark:  customerLogos.onDark,

    // Site photo (cover page hero, below customer lockup)
    sitePhoto,

    // Company details from report settings
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

    // Report template config
    // showSiteOverview removed 26-Apr-2026 (audit item 7) — always rendered.
    showCoverPage: tenantSettings?.report_show_cover_page ?? true,
    showContents: tenantSettings?.report_show_contents ?? true,
    showExecutiveSummary: tenantSettings?.report_show_executive_summary ?? true,
    showSignOff: tenantSettings?.report_show_sign_off ?? true,
    customHeaderText: tenantSettings?.report_header_text ?? undefined,
    customFooterText: tenantSettings?.report_footer_text ?? undefined,
    signOffFields: (tenantSettings?.report_sign_off_fields as string[] | null) ?? undefined,
  }

  try {
    const buffer = await generatePMAssetReport(reportInput)
    const filename = `PM Asset Report - ${siteName} - ${new Date().toISOString().split('T')[0]}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('PM Asset Report generation failed:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
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
