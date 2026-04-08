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
import type { PmAssetReportInput, PmAssetSection, PmAssetTask } from '@/lib/reports/pm-asset-report'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'

export async function GET(request: NextRequest) {
  const checkId = request.nextUrl.searchParams.get('check_id')
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

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
    .single()

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
    .single()

  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  // Fetch site details for customer info
  const { data: site } = await supabase
    .from('sites')
    .select('*, customers(name)')
    .eq('id', check.site_id)
    .single()

  // Fetch check_assets with related asset info
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_asset_id, location, job_plans(name, code))')
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

  // Fetch tenant settings for branding
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('product_name, primary_colour')
    .eq('tenant_id', tenantId)
    .single()

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'

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

  // Build per-asset sections
  const assetSections: PmAssetSection[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_asset_id: string | null; location: string | null; job_plans: { name: string; code: string | null } | null } | null
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
      assetId: asset?.maximo_asset_id ?? ca.asset_id,
      site: site?.name ?? (check.sites as { name: string } | null)?.name ?? 'Unknown',
      location: asset?.location ?? '—',
      jobPlanName: asset?.job_plans?.name ?? (check.job_plans as { name: string } | null)?.name ?? '—',
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

    assets: assetSections,
    overallNotes: check.notes ?? undefined,
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
