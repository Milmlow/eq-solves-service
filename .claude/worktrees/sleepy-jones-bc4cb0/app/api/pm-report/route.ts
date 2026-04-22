/**
 * GET /api/pm-report?check_id=xxx
 *
 * Generates and returns a DOCX PM Check Report for the given maintenance check.
 * Requires supervisor+ role (canWrite permission).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePMCheckReport } from '@/lib/reports/pm-check-report'
import type { PmCheckReportInput, PmCheckReportItem } from '@/lib/reports/pm-check-report'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'

export async function GET(request: NextRequest) {
  const checkId = request.nextUrl.searchParams.get('check_id')
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

  // Complexity param accepted for consistency — pm-check is a simple report
  // so complexity mainly controls whether notes are included
  const complexityParam = request.nextUrl.searchParams.get('complexity') as 'summary' | 'standard' | 'detailed' | null
  const validComplexities = ['summary', 'standard', 'detailed'] as const
  const _complexity = complexityParam && validComplexities.includes(complexityParam) ? complexityParam : 'standard'
  void _complexity // reserved for future use

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

  // Fetch maintenance check
  const { data: check } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  // Fetch check items
  const { data: items } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')

  if (!items) {
    return NextResponse.json({ error: 'Failed to fetch check items' }, { status: 500 })
  }

  // Fetch tenant settings for branding
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('product_name, primary_colour')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'

  // Resolve assigned_to and completed_by names
  const userIds = [
    check.assigned_to,
    ...items.flatMap((i) => [i.completed_by]).filter(Boolean),
  ].filter(Boolean)

  const userMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  // Build report input
  const reportItems: PmCheckReportItem[] = items.map((item, idx) => ({
    number: idx + 1,
    description: item.description,
    result: item.result,
    notes: item.notes,
    completedBy: item.completed_by ? (userMap[item.completed_by] ?? null) : null,
    completedAt: item.completed_at,
  }))

  const input: PmCheckReportInput = {
    checkId: check.id,
    siteName: (check.sites as { name: string } | null)?.name ?? 'Unknown Site',
    jobPlanName: (check.job_plans as { name: string } | null)?.name ?? 'Unknown Job Plan',
    checkDate: check.created_at,
    dueDate: check.due_date,
    startedAt: check.started_at,
    completedAt: check.completed_at,
    status: check.status,
    assignedTo: check.assigned_to ? (userMap[check.assigned_to] ?? null) : null,
    tenantProductName: productName,
    primaryColour: primaryColour,
    items: reportItems,
  }

  try {
    const buffer = await generatePMCheckReport(input)

    const filename = `PM Check Report - ${input.siteName} - ${new Date().toISOString().split('T')[0]}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('PM report generation failed:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
