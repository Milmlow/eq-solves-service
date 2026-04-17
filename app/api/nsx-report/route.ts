/**
 * GET /api/nsx-report?site_id=xxx
 *
 * Generates and returns a DOCX NSX/MCCB Test Report for the given site.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateNsxReport } from '@/lib/reports/nsx-report'
import type { NsxReportInput, NsxReportTest, NsxReportReading } from '@/lib/reports/nsx-report'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('site_id')
  if (!siteId) {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400 })
  }

  // Complexity override — falls back to tenant default if not provided
  const complexityParam = request.nextUrl.searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const complexityOverride = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : null

  const supabase = await createClient()

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

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, code')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  // Fetch tenant settings for branding + report config
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('product_name, primary_colour, report_complexity, report_company_name, report_company_abn, report_company_phone, report_company_address, report_header_text, report_footer_text, report_show_cover_page, report_show_contents, report_show_executive_summary, report_show_sign_off, report_sign_off_fields, logo_url, report_logo_url')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const complexity = complexityOverride ?? (tenantSettings?.report_complexity as 'summary' | 'standard' | 'detailed' | null) ?? 'standard'

  const { data: testsRaw } = await supabase
    .from('nsx_tests')
    .select('*, assets(name, asset_type, serial_number, maximo_id, location)')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .order('test_date', { ascending: true })

  if (!testsRaw || testsRaw.length === 0) {
    return NextResponse.json({ error: 'No NSX tests found for this site' }, { status: 404 })
  }

  const testIds = testsRaw.map((t) => t.id)
  const { data: allReadings } = await supabase
    .from('nsx_test_readings')
    .select('*')
    .in('nsx_test_id', testIds)
    .order('sort_order')

  const readingsMap: Record<string, NsxReportReading[]> = {}
  for (const r of allReadings ?? []) {
    const key = r.nsx_test_id as string
    if (!readingsMap[key]) readingsMap[key] = []
    readingsMap[key].push({
      label: r.label as string,
      value: r.value as string,
      unit: r.unit as string | null,
      isPass: r.is_pass as boolean | null,
      sortOrder: r.sort_order as number,
    })
  }

  const testerIds = [...new Set(testsRaw.map((t) => t.tested_by).filter(Boolean))]
  const testerMap: Record<string, string> = {}
  if (testerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', testerIds)
    for (const p of profiles ?? []) {
      testerMap[p.id] = p.full_name ?? p.email
    }
  }

  const tests: NsxReportTest[] = testsRaw.map((t) => {
    const asset = t.assets as { name: string; asset_type: string; serial_number: string | null; maximo_id: string | null; location: string | null } | null
    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetType: asset?.asset_type ?? '',
      location: asset?.location ?? null,
      assetId: asset?.maximo_id ?? null,
      testDate: t.test_date as string,
      testedBy: t.tested_by ? (testerMap[t.tested_by as string] ?? null) : null,
      testType: t.test_type as string,
      cbMake: t.cb_make as string | null,
      cbModel: t.cb_model as string | null,
      cbSerial: t.cb_serial as string | null,
      cbRating: t.cb_rating as string | null,
      cbPoles: t.cb_poles as string | null,
      tripUnit: t.trip_unit as string | null,
      overallResult: t.overall_result as string,
      notes: t.notes as string | null,
      readings: readingsMap[t.id as string] ?? [],
    }
  })

  // Fetch logo image if URL exists
  const logoUrl = tenantSettings?.report_logo_url || tenantSettings?.logo_url
  let logoImage: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | undefined
  if (logoUrl) {
    try {
      const logoRes = await fetch(logoUrl)
      if (logoRes.ok) {
        const buf = Buffer.from(await logoRes.arrayBuffer())
        const ct = logoRes.headers.get('content-type') ?? ''
        const imgType = ct.includes('png') ? 'png' as const : 'jpg' as const
        logoImage = { data: buf, type: imgType, width: 180, height: 60 }
      }
    } catch { /* skip logo if fetch fails */ }
  }

  const input: NsxReportInput = {
    siteName: site.name,
    siteCode: site.code ?? null,
    tenantProductName: productName,
    primaryColour: primaryColour,
    complexity,
    tests,
    // Report settings
    logoImage,
    companyName: tenantSettings?.report_company_name ?? undefined,
    companyAbn: tenantSettings?.report_company_abn ?? undefined,
    companyPhone: tenantSettings?.report_company_phone ?? undefined,
    companyAddress: tenantSettings?.report_company_address ?? undefined,
    showCoverPage: tenantSettings?.report_show_cover_page ?? true,
    showContents: tenantSettings?.report_show_contents ?? true,
    showExecutiveSummary: tenantSettings?.report_show_executive_summary ?? true,
    showSignOff: tenantSettings?.report_show_sign_off ?? true,
    customHeaderText: tenantSettings?.report_header_text ?? undefined,
    customFooterText: tenantSettings?.report_footer_text ?? undefined,
    signOffFields: (tenantSettings?.report_sign_off_fields as string[] | null) ?? undefined,
  }

  try {
    const buffer = await generateNsxReport(input)
    const filename = `NSX Test Report - ${site.name} - ${new Date().toISOString().split('T')[0]}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('NSX report generation failed:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
