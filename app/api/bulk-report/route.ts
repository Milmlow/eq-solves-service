/**
 * GET /api/bulk-report?site_id=xxx
 *
 * Generates a ZIP file containing all ACB and NSX DOCX reports for the given site.
 * Returns a ZIP attachment.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateAcbReport } from '@/lib/reports/acb-report'
import { generateNsxReport } from '@/lib/reports/nsx-report'
import type { AcbReportInput, AcbReportTest, AcbReportReading } from '@/lib/reports/acb-report'
import type { NsxReportInput, NsxReportTest, NsxReportReading } from '@/lib/reports/nsx-report'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import JSZip from 'jszip'

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

  // Auth + role check
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

  // Fetch site + tenant settings
  const [{ data: site }, { data: tenantSettings }] = await Promise.all([
    supabase.from('sites').select('id, name, code').eq('id', siteId).maybeSingle(),
    supabase.from('tenant_settings').select('product_name, primary_colour, report_complexity, report_company_name, report_company_abn, report_company_phone, report_company_address, report_header_text, report_footer_text, report_show_cover_page, report_show_contents, report_show_executive_summary, report_show_sign_off, report_sign_off_fields, logo_url, report_logo_url').eq('tenant_id', tenantId).maybeSingle(),
  ])

  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'
  const complexity = complexityOverride ?? (tenantSettings?.report_complexity as 'summary' | 'standard' | 'detailed' | null) ?? 'standard'

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

  // Fetch ACB + NSX tests in parallel
  const [{ data: acbTestsRaw }, { data: nsxTestsRaw }] = await Promise.all([
    supabase
      .from('acb_tests')
      .select('*, assets(name, asset_type, serial_number, maximo_id, location, manufacturer, model)')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .order('test_date', { ascending: true }),
    supabase
      .from('nsx_tests')
      .select('*, assets(name, asset_type, serial_number, maximo_id, location, manufacturer, model)')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .order('test_date', { ascending: true }),
  ])

  const hasAcb = (acbTestsRaw?.length ?? 0) > 0
  const hasNsx = (nsxTestsRaw?.length ?? 0) > 0

  if (!hasAcb && !hasNsx) {
    return NextResponse.json({ error: 'No test records found for this site' }, { status: 404 })
  }

  // Fetch readings + tester names in parallel
  const acbIds = (acbTestsRaw ?? []).map((t) => t.id as string)
  const nsxIds = (nsxTestsRaw ?? []).map((t) => t.id as string)
  const allTesterIds = [
    ...(acbTestsRaw ?? []).map((t) => t.tested_by),
    ...(nsxTestsRaw ?? []).map((t) => t.tested_by),
  ].filter(Boolean) as string[]
  const uniqueTesterIds = [...new Set(allTesterIds)]

  const [{ data: acbReadings }, { data: nsxReadings }, testerProfiles] = await Promise.all([
    acbIds.length > 0
      ? supabase.from('acb_test_readings').select('*').in('acb_test_id', acbIds).order('sort_order')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    nsxIds.length > 0
      ? supabase.from('nsx_test_readings').select('*').in('nsx_test_id', nsxIds).order('sort_order')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    uniqueTesterIds.length > 0
      ? supabase.from('profiles').select('id, full_name, email').in('id', uniqueTesterIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ])

  const testerMap: Record<string, string> = {}
  for (const p of (testerProfiles as { data: { id: string; full_name: string | null; email: string }[] | null }).data ?? []) {
    testerMap[p.id] = p.full_name ?? p.email
  }

  const zip = new JSZip()
  const dateStr = new Date().toISOString().split('T')[0]

  // ── Generate ACB report ──
  if (hasAcb) {
    const acbReadingsMap: Record<string, AcbReportReading[]> = {}
    for (const r of acbReadings ?? []) {
      const key = (r as Record<string, unknown>).acb_test_id as string
      if (!acbReadingsMap[key]) acbReadingsMap[key] = []
      acbReadingsMap[key].push({
        label: (r as Record<string, unknown>).label as string,
        value: (r as Record<string, unknown>).value as string,
        unit: (r as Record<string, unknown>).unit as string | null,
        isPass: (r as Record<string, unknown>).is_pass as boolean | null,
        sortOrder: (r as Record<string, unknown>).sort_order as number,
      })
    }

    const acbTests: AcbReportTest[] = (acbTestsRaw ?? []).map((t) => {
      const asset = t.assets as { name: string; asset_type: string; serial_number: string | null; maximo_id: string | null; location: string | null; manufacturer: string | null; model: string | null } | null
      return {
        assetName: asset?.name ?? 'Unknown Asset',
        assetType: asset?.asset_type ?? '',
        location: asset?.location ?? null,
        assetId: asset?.maximo_id ?? null,
        jobPlan: null,
        testDate: t.test_date as string,
        testedBy: t.tested_by ? (testerMap[t.tested_by as string] ?? null) : null,
        testType: t.test_type as string,
        cbMake: t.cb_make as string | null,
        cbModel: t.cb_model as string | null,
        cbSerial: t.cb_serial as string | null,
        overallResult: t.overall_result as string,
        notes: t.notes as string | null,
        readings: acbReadingsMap[t.id as string] ?? [],
      }
    })

    const acbInput: AcbReportInput = {
      siteName: site.name,
      siteCode: site.code ?? null,
      tenantProductName: productName,
      primaryColour,
      complexity,
      tests: acbTests,
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

    const acbBuffer = await generateAcbReport(acbInput)
    zip.file(`ACB Test Report - ${site.name} - ${dateStr}.docx`, acbBuffer)
  }

  // ── Generate NSX report ──
  if (hasNsx) {
    const nsxReadingsMap: Record<string, NsxReportReading[]> = {}
    for (const r of nsxReadings ?? []) {
      const key = (r as Record<string, unknown>).nsx_test_id as string
      if (!nsxReadingsMap[key]) nsxReadingsMap[key] = []
      nsxReadingsMap[key].push({
        label: (r as Record<string, unknown>).label as string,
        value: (r as Record<string, unknown>).value as string,
        unit: (r as Record<string, unknown>).unit as string | null,
        isPass: (r as Record<string, unknown>).is_pass as boolean | null,
        sortOrder: (r as Record<string, unknown>).sort_order as number,
      })
    }

    const nsxTests: NsxReportTest[] = (nsxTestsRaw ?? []).map((t) => {
      const asset = t.assets as { name: string; asset_type: string; serial_number: string | null; maximo_id: string | null; location: string | null; manufacturer: string | null; model: string | null } | null
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
        readings: nsxReadingsMap[t.id as string] ?? [],
      }
    })

    const nsxInput: NsxReportInput = {
      siteName: site.name,
      siteCode: site.code ?? null,
      tenantProductName: productName,
      primaryColour,
      complexity,
      tests: nsxTests,
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

    const nsxBuffer = await generateNsxReport(nsxInput)
    zip.file(`NSX Test Report - ${site.name} - ${dateStr}.docx`, nsxBuffer)
  }

  try {
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    const filename = `Test Reports - ${site.name} - ${dateStr}.zip`

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Bulk report generation failed:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
