/**
 * GET /api/maintenance-checklist?check_id=xxx
 *
 * Generates and returns a printable Maintenance Checklist (DOCX) for the given
 * maintenance check. Designed for site teams to print, complete by hand, and
 * then enter results into the app.
 *
 * Requires supervisor+ role (canWrite permission).
 *
 * Data gathering lives in lib/reports/maintenance-checklist-input.ts so the
 * same input can be built outside this route (e.g. the pre-visit tech brief
 * attaches the run-sheet to its email). This route owns auth + the response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateMaintenanceChecklist } from '@/lib/reports/maintenance-checklist'
import {
  buildMaintenanceChecklistInput,
  normaliseChecklistFormat,
} from '@/lib/reports/maintenance-checklist-input'
import type { Role } from '@/lib/types'
import { canWrite } from '@/lib/utils/roles'
import { captureSlowReportRun } from '@/lib/observability/report-duration-canary'

// Field run-sheet DOCX is the lightest of the three report routes but still
// runs through a check_assets fetch + items fan-out + logo decode +
// docx-tree synthesis. Set the runtime hint so we don't get cut off at
// the default. Actual cap is the Netlify plan limit.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const startedAt = Date.now()
  const checkId = request.nextUrl.searchParams.get('check_id')
  const format = normaliseChecklistFormat(request.nextUrl.searchParams.get('format'))
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

  let checklistInput
  try {
    checklistInput = await buildMaintenanceChecklistInput(
      supabase,
      checkId,
      membership.tenant_id,
      format,
    )
  } catch (err) {
    console.error('Maintenance Checklist input build failed:', err)
    return NextResponse.json({ error: 'Failed to build checklist' }, { status: 500 })
  }

  if (!checklistInput) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  try {
    const buffer = await generateMaintenanceChecklist(checklistInput)
    const siteName = checklistInput.siteName
    const formatLabel = format === 'simple' ? 'summary' : format
    const filename = `Run-Sheet - ${siteName} - ${formatLabel} - ${new Date().toISOString().split('T')[0]}.docx`

    captureSlowReportRun({
      route: 'GET /api/maintenance-checklist',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 200,
      scale: {
        format,
        assets: checklistInput.assets.length,
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
    console.error('Maintenance Checklist generation failed:', err)
    captureSlowReportRun({
      route: 'GET /api/maintenance-checklist',
      checkId,
      durationMs: Date.now() - startedAt,
      status: 500,
      scale: { format, errored: 1 },
    })
    return NextResponse.json({ error: 'Checklist generation failed' }, { status: 500 })
  }
}
