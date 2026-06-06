/**
 * GET /api/pm-asset-report?check_id=xxx
 *
 * Generates and returns a professional PM Asset Report (DOCX) for the given
 * maintenance check. Includes cover page, site overview, executive summary,
 * per-asset sections with task checklists, and sign-off page.
 *
 * Requires supervisor+ role (canWrite permission).
 *
 * Data gathering lives in lib/reports/pm-asset-report-input.ts so the same
 * input can be built outside this route (e.g. the pre-visit tech brief
 * attaches the last-visit report to its email). This route owns auth + the
 * HTTP response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePMAssetReport } from '@/lib/reports/pm-asset-report'
import { buildPmAssetReportInput, type ReportComplexity } from '@/lib/reports/pm-asset-report-input'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import { captureSlowReportRun } from '@/lib/observability/report-duration-canary'

// DOCX generation is CPU-bound and runs through ~12 sequential Supabase
// queries before the docx-tree synthesis starts. At Jemena-scale (multi-site
// reports with 50+ linked tests) the round-trip approaches 20s. Set the
// hint to 60s so Netlify doesn't cut us off at the default.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const checkId = request.nextUrl.searchParams.get('check_id')
  if (!checkId) {
    return NextResponse.json({ error: 'check_id is required' }, { status: 400 })
  }

  // Complexity override — falls back to tenant default if not provided
  const complexityParam = request.nextUrl.searchParams.get('complexity') as ReportComplexity | null
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

  let reportInput
  try {
    reportInput = await buildPmAssetReportInput(
      supabase,
      checkId,
      membership.tenant_id,
      complexityOverride,
    )
  } catch (err) {
    console.error('PM Asset Report input build failed:', err)
    return NextResponse.json({ error: 'Failed to build report' }, { status: 500 })
  }

  if (!reportInput) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  // Total check-item count for the slow-run canary — counts ALL items for the
  // check (including check-level / unlinked items), matching the pre-refactor
  // `allItems.length` metric. Cheap HEAD count; report content is unaffected.
  const { count: itemCount } = await supabase
    .from('maintenance_check_items')
    .select('id', { count: 'exact', head: true })
    .eq('check_id', checkId)

  try {
    const buffer = await generatePMAssetReport(reportInput)
    const siteName = reportInput.siteName
    const filename = `PM Asset Report - ${siteName} - ${new Date().toISOString().split('T')[0]}.docx`

    captureSlowReportRun({
      route: 'GET /api/pm-asset-report',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 200,
      scale: {
        assets: reportInput.assets.length,
        items: itemCount ?? 0,
        acbTests: reportInput.linkedTests?.acb?.length ?? 0,
        nsxTests: reportInput.linkedTests?.nsx?.length ?? 0,
        rcdTests: reportInput.linkedTests?.rcd?.length ?? 0,
      },
    })

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('PM Asset Report generation failed:', err)
    captureSlowReportRun({
      route: 'GET /api/pm-asset-report',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 500,
      scale: { errored: 1 },
    })
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
