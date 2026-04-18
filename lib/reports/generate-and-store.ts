'use server'

/**
 * generate-and-store.ts
 *
 * Shared helper: generates DOCX for a maintenance check, uploads to
 * Supabase Storage, computes SHA-256 hash, returns paths + hash.
 *
 * This is called by issueMaintenanceReportAction (reports/actions.ts)
 * and could later be called by a batch-generation cron.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { generatePMCheckReport } from '@/lib/reports/pm-check-report'
import type { PmCheckReportInput, PmCheckReportItem } from '@/lib/reports/pm-check-report'
import { convertDocxToPdf } from '@/lib/reports/pdf-conversion'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface GeneratedReport {
  docxPath: string
  pdfPath: string | null // null until PDF generation is wired
  contentHash: string // SHA-256 hex of the DOCX
  docxBuffer: Buffer
}

/**
 * Generate a DOCX report for a maintenance check, upload to Storage,
 * and return the paths + content hash.
 *
 * Uses the _user's_ Supabase client for data reads (RLS-scoped) and
 * the admin client for Storage writes (service role — Storage RLS is
 * separate from table RLS and we need bucket write access).
 */
export async function generateAndStoreReport(
  supabase: SupabaseClient,
  tenantId: string,
  maintenanceCheckId: string,
  revision: number,
): Promise<GeneratedReport> {
  // ── Fetch maintenance check ──
  const { data: check, error: checkError } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name)')
    .eq('id', maintenanceCheckId)
    .single()

  if (checkError || !check) {
    throw new Error(`Failed to fetch maintenance check: ${checkError?.message ?? 'not found'}`)
  }

  // ── Fetch check items ──
  const { data: items, error: itemsError } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', maintenanceCheckId)
    .order('sort_order')

  if (itemsError || !items) {
    throw new Error(`Failed to fetch check items: ${itemsError?.message ?? 'empty'}`)
  }

  // ── Fetch tenant settings for branding ──
  const { data: tenantSettings } = await supabase
    .from('tenant_settings')
    .select('product_name, primary_colour')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const primaryColour = tenantSettings?.primary_colour ?? '#3DA8D8'

  // ── Resolve user display names ──
  const userIds = [
    check.assigned_to,
    ...items.flatMap((i: Record<string, unknown>) => [i.completed_by]).filter(Boolean),
  ].filter(Boolean) as string[]

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

  // ── Build report input ──
  const reportItems: PmCheckReportItem[] = items.map((item: Record<string, unknown>, idx: number) => ({
    number: idx + 1,
    description: item.description as string,
    result: item.result as 'pass' | 'fail' | 'na' | null,
    notes: item.notes as string | null,
    completedBy: item.completed_by ? (userMap[item.completed_by as string] ?? null) : null,
    completedAt: item.completed_at as string | null,
  }))

  const siteName = (check.sites as { name: string } | null)?.name ?? 'Unknown Site'
  const jobPlanName = (check.job_plans as { name: string } | null)?.name ?? 'Unknown Job Plan'

  const input: PmCheckReportInput = {
    checkId: check.id,
    siteName,
    jobPlanName,
    checkDate: check.created_at,
    dueDate: check.due_date,
    startedAt: check.started_at,
    completedAt: check.completed_at,
    status: check.status,
    assignedTo: check.assigned_to ? (userMap[check.assigned_to] ?? null) : null,
    tenantProductName: productName,
    primaryColour: primaryColour.replace('#', ''),
    items: reportItems,
  }

  // ── Generate DOCX ──
  const docxBuffer = Buffer.from(await generatePMCheckReport(input))

  // ── Compute SHA-256 ──
  const contentHash = createHash('sha256').update(docxBuffer).digest('hex')

  // ── Upload to Supabase Storage ──
  const basePath = `${tenantId}/reports/${maintenanceCheckId}/${revision}`
  const docxPath = `${basePath}.docx`

  const admin = createAdminClient()
  const { error: uploadError } = await admin.storage
    .from('attachments')
    .upload(docxPath, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true, // overwrite if re-run (idempotency)
    })

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }

  // ── Attempt PDF conversion (graceful — null if no backend configured) ──
  let pdfPath: string | null = null
  try {
    const pdfBuffer = await convertDocxToPdf(docxBuffer)
    if (pdfBuffer) {
      pdfPath = `${basePath}.pdf`
      const { error: pdfUploadError } = await admin.storage
        .from('attachments')
        .upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })
      if (pdfUploadError) {
        console.error('PDF upload failed:', pdfUploadError.message)
        pdfPath = null
      }
    }
  } catch (pdfErr) {
    console.error('PDF conversion failed (non-fatal):', pdfErr)
  }

  return { docxPath, pdfPath, contentHash, docxBuffer }
}
