/**
 * GET /api/maintenance-checklist?check_id=xxx
 *
 * Generates and returns a printable Maintenance Checklist (DOCX) for the given
 * maintenance check. Designed for site teams to print, complete by hand, and
 * then enter results into the app.
 *
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateMaintenanceChecklist } from '@/lib/reports/maintenance-checklist'
import type { MaintenanceChecklistInput, ChecklistAsset } from '@/lib/reports/maintenance-checklist'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import { fetchLogoImage } from '@/lib/reports/report-branding'
import { TENANT_LOGO_LIGHT, TENANT_LOGO_ON_DARK, CUSTOMER_LOGO_LIGHT } from '@/lib/reports/sizing'

/**
 * Map the public-facing format token (summary/standard/detailed) to the legacy
 * generator format (simple/detailed). 'standard' is a new middle ground —
 * runs the detailed layout but suppresses the most granular task notes.
 *
 * Older callers using 'simple' continue to work.
 */
function normaliseFormat(raw: string | null): 'simple' | 'standard' | 'detailed' {
  const v = (raw ?? 'standard').toLowerCase()
  if (v === 'simple' || v === 'summary') return 'simple'
  if (v === 'detailed') return 'detailed'
  return 'standard'
}

export async function GET(request: NextRequest) {
  const checkId = request.nextUrl.searchParams.get('check_id')
  const format = normaliseFormat(request.nextUrl.searchParams.get('format'))
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Role check — supervisor+ to generate checklists
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
    .select('*, job_plans(name, code), sites(name)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  // Fetch check_assets with related asset info
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location)')
    .eq('check_id', checkId)
    .order('created_at')

  if (!checkAssets) {
    return NextResponse.json({ error: 'Failed to fetch check assets' }, { status: 500 })
  }

  // Fetch ALL check items for this check in one query (lift Supabase 1000-row default)
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')
    .limit(10000)

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

  // Fetch tenant settings for branding — primary colour drives the brand
  // strip on the field run-sheet; logos render in the strip when available.
  // Without this fetch the strip fell back to EQ Sky + showed text-only
  // company name instead of the SKS (or other tenant) logo.
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select(`
      product_name, report_company_name,
      primary_colour, deep_colour, ice_colour, ink_colour,
      report_logo_url, report_logo_url_on_dark, logo_url, logo_url_on_dark
    `)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const companyName = tenantSettings?.report_company_name ?? productName
  const primaryColour = (tenantSettings?.primary_colour ?? '#3DA8D8').replace('#', '')

  // Customer logo (if site has a customer)
  let customerLogoUrl: string | null = null
  const siteRow = check.sites as { name?: string; customer_id?: string | null } | null
  if (siteRow?.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('logo_url')
      .eq('id', siteRow.customer_id)
      .maybeSingle()
    customerLogoUrl = customer?.logo_url ?? null
  }

  // Resolve which tenant-light logo to use. Field run-sheet brand strip is
  // a dark surface (tenant brand colour fill) so prefer the on-dark variant;
  // fall back to the light one if no dark variant uploaded.
  const tenantLogoLightUrl = tenantSettings?.report_logo_url ?? tenantSettings?.logo_url ?? null
  const tenantLogoDarkUrl = tenantSettings?.report_logo_url_on_dark ?? tenantSettings?.logo_url_on_dark ?? null

  const [tenantLogoImage, customerLogoImage] = await Promise.all([
    fetchLogoImage(tenantLogoDarkUrl ?? tenantLogoLightUrl, TENANT_LOGO_ON_DARK),
    fetchLogoImage(customerLogoUrl, CUSTOMER_LOGO_LIGHT),
  ])

  // Resolve user names (assigned_to)
  const userIds = new Set<string>()
  if (check.assigned_to) userIds.add(check.assigned_to)

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

  // Build per-asset sections
  const checklistAssets: ChecklistAsset[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_id: string | null; location: string | null } | null
    const items = itemsByCheckAsset[ca.id] ?? []

    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetId: asset?.maximo_id ?? ca.asset_id,
      location: asset?.location ?? '—',
      workOrderNumber: ca.work_order_number ?? null,
      tasks: items.map((item, idx) => ({
        order: idx + 1,
        description: item.description,
      })),
      notes: ca.notes ?? null,
    }
  })

  // Format dates as Australian long-form ("26 April 2026") to match the
  // other report generators. Without an explicit locale, Node defaults to
  // the server's locale (Netlify Linux = en-US "5/1/2026") which both
  // looks American and ambiguous to AU readers (5 Jan vs 1 May).
  const dateFmt: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' }
  const dueDateStr = check.due_date ? new Date(check.due_date).toLocaleDateString('en-AU', dateFmt) : '—'
  const printedDateStr = new Date().toLocaleDateString('en-AU', dateFmt)
  // Capitalise frequency for display ("quarterly" -> "Quarterly").
  // DB enum is lowercase; the UI capitalises it everywhere except here.
  const rawFreq = check.frequency?.replace(/_/g, ' ') ?? '—'
  const frequency = rawFreq.charAt(0).toUpperCase() + rawFreq.slice(1)

  // Build the checklist input
  const checklistInput: MaintenanceChecklistInput = {
    companyName,
    checkName: check.custom_name ?? `${(check.job_plans as { name: string } | null)?.name ?? 'Check'} - ${frequency}`,
    siteName: (check.sites as { name: string } | null)?.name ?? 'Unknown Site',
    dueDate: dueDateStr,
    frequency,
    assignedTo: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : null,
    maximoWONumber: null,  // Not stored at check level currently
    maximoPMNumber: (check.job_plans as { code: string | null } | null)?.code ?? null,
    printedDate: printedDateStr,
    assets: checklistAssets,
    tenantProductName: productName,
    primaryColour,
    deepColour: tenantSettings?.deep_colour ?? null,
    iceColour: tenantSettings?.ice_colour ?? null,
    inkColour: tenantSettings?.ink_colour ?? null,
    tenantLogoImage,
    customerLogoImage,
    format,
  }

  try {
    const buffer = await generateMaintenanceChecklist(checklistInput)
    const checkName = check.custom_name ?? 'Checklist'
    const filename = `${checkName}-checklist-${format}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Maintenance Checklist generation failed:', err)
    return NextResponse.json({ error: 'Checklist generation failed' }, { status: 500 })
  }
}
