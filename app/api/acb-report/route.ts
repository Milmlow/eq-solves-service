/**
 * GET /api/acb-report?site_id=xxx
 *
 * Generates and returns a DOCX ACB Test Report for the given site.
 * All active ACB tests for the site are included.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateAcbReport } from '@/lib/reports/acb-report'
import type { AcbReportInput, AcbReportTest, AcbReportReading } from '@/lib/reports/acb-report'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('site_id')
  if (!siteId) {
    return NextResponse.json({ error: 'site_id is required' }, { status: 400 })
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
    .maybeSingle()

  if (!membership || !canWrite(membership.role as Role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const tenantId = membership.tenant_id

  // Fetch site
  const { data: site } = await supabase
    .from('sites')
    .select('id, name, code')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  // Fetch tenant settings for branding
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('product_name, primary_colour')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'

  // Fetch all active ACB tests for this site
  const { data: testsRaw } = await supabase
    .from('acb_tests')
    .select('*, assets(name, asset_type, serial_number, maximo_id, location, manufacturer, model)')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .order('test_date', { ascending: true })

  if (!testsRaw || testsRaw.length === 0) {
    return NextResponse.json({ error: 'No ACB tests found for this site' }, { status: 404 })
  }

  // Fetch readings for all tests
  const testIds = testsRaw.map((t) => t.id)
  const { data: allReadings } = await supabase
    .from('acb_test_readings')
    .select('*')
    .in('acb_test_id', testIds)
    .order('sort_order')

  const readingsMap: Record<string, AcbReportReading[]> = {}
  for (const r of allReadings ?? []) {
    const key = r.acb_test_id as string
    if (!readingsMap[key]) readingsMap[key] = []
    readingsMap[key].push({
      label: r.label as string,
      value: r.value as string,
      unit: r.unit as string | null,
      isPass: r.is_pass as boolean | null,
      sortOrder: r.sort_order as number,
    })
  }

  // Resolve tested_by names
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

  // Build report input
  const tests: AcbReportTest[] = testsRaw.map((t) => {
    const asset = t.assets as { name: string; asset_type: string; serial_number: string | null; maximo_id: string | null; location: string | null; manufacturer: string | null; model: string | null } | null
    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetType: asset?.asset_type ?? '',
      location: asset?.location ?? null,
      assetId: asset?.maximo_id ?? null,
      jobPlan: null, // job plan linkage not in current schema
      testDate: t.test_date as string,
      testedBy: t.tested_by ? (testerMap[t.tested_by as string] ?? null) : null,
      testType: t.test_type as string,
      cbMake: t.cb_make as string | null,
      cbModel: t.cb_model as string | null,
      cbSerial: t.cb_serial as string | null,
      overallResult: t.overall_result as string,
      notes: t.notes as string | null,
      readings: readingsMap[t.id as string] ?? [],
    }
  })

  const input: AcbReportInput = {
    siteName: site.name,
    siteCode: site.code ?? null,
    tenantProductName: productName,
    primaryColour: primaryColour,
    tests,
  }

  try {
    const buffer = await generateAcbReport(input)

    const filename = `ACB Test Report - ${site.name} - ${new Date().toISOString().split('T')[0]}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('ACB report generation failed:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
