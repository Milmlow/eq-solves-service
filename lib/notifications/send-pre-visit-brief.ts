/**
 * send-pre-visit-brief.ts — shared composer for the pre-visit tech brief.
 *
 * Composes and (optionally) sends the brief for one maintenance check:
 * email (with ICS + run-sheet + last-visit-report attachments) + in-app bell
 * + audit log, and stamps maintenance_checks.pre_visit_brief_sent_at.
 *
 * Called by BOTH:
 *   - sendTechBriefAction (manual button — wraps this in requireUser + role +
 *     withIdempotency)
 *   - the day-before cron (/api/cron/pre-visit-brief — service-role client,
 *     CRON_SECRET-gated)
 *
 * Auth + idempotency are the CALLER's responsibility. This function trusts the
 * supabase client + tenantId it's handed and does no role checking.
 *
 * dryRun: validates the check is sendable (tech + email + schedule) and returns
 * what WOULD happen, WITHOUT generating attachments, sending, or writing — the
 * cron's safe default until PRE_VISIT_BRIEF_CRON_ENABLED is set.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/lib/actions/audit'
import { createNotification } from '@/lib/actions/notifications'
import { sendTechBriefEmail } from '@/lib/email/send-tech-brief'
import { buildIcs } from '@/lib/utils/build-ics'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { generateMaintenanceChecklist } from '@/lib/reports/maintenance-checklist'
import { buildMaintenanceChecklistInput } from '@/lib/reports/maintenance-checklist-input'
import { generatePMAssetReport } from '@/lib/reports/pm-asset-report'
import { buildPmAssetReportInput } from '@/lib/reports/pm-asset-report-input'

export interface ComposeBriefOptions {
  /** Compose + validate only; no attachments, send, or writes. */
  dryRun?: boolean
  /** Audit mutationId for replay-dedup (manual path). */
  mutationId?: string | null
  /** Stamp maintenance_checks.pre_visit_brief_sent_at on a real send. */
  markSent?: boolean
}

export type ComposeBriefResult =
  | { success: true; message: string; emailSent: boolean; dryRun?: boolean }
  | { success: false; error: string }

export async function composeAndSendPreVisitBrief(
  supabase: SupabaseClient,
  checkId: string,
  tenantId: string,
  opts: ComposeBriefOptions = {},
): Promise<ComposeBriefResult> {
  // Fetch the check with everything we need in one query.
  const { data: check, error: checkErr } = await supabase
    .from('maintenance_checks')
    .select(`
      id, custom_name, assigned_to, site_id, due_date, status,
      job_plans(name),
      sites(
        id, name, address, city, state, postcode, country,
        gate_code, parking_notes, after_hours_phone, safety_notes,
        latitude, longitude
      )
    `)
    .eq('id', checkId)
    .maybeSingle()

  if (checkErr || !check) {
    return { success: false, error: 'Check not found.' }
  }

  if (!check.assigned_to) {
    return { success: false, error: 'No technician assigned. Assign a technician before sending the brief.' }
  }

  // Resolve tech profile (name + email)
  const { data: techProfile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', check.assigned_to as string)
    .maybeSingle()

  const techEmail = (techProfile as { full_name?: string | null; email?: string | null } | null)?.email
  if (!techEmail) {
    return { success: false, error: 'Assigned technician has no email address on their profile.' }
  }
  const techName = (techProfile as { full_name?: string | null } | null)?.full_name ?? null

  // Resolve scheduled_start_at — fall back to 08:00 on due_date if unset
  const rawStart = (check as unknown as { scheduled_start_at?: string | null }).scheduled_start_at
  let scheduledStartAt: string
  if (rawStart) {
    scheduledStartAt = rawStart
  } else if (check.due_date) {
    scheduledStartAt = `${check.due_date}T08:00:00`
  } else {
    return { success: false, error: 'No scheduled start time or due date is set on this check.' }
  }

  // dryRun stops here — the gating checks all passed, so the cron knows this
  // check WOULD send. No attachments, email, bell, audit, or markSent.
  if (opts.dryRun) {
    return {
      success: true,
      dryRun: true,
      emailSent: false,
      message: `DRY RUN — would send pre-visit brief to ${techEmail}`,
    }
  }

  type SiteShape = {
    id: string; name: string; address: string | null; city: string | null
    state: string | null; postcode: string | null; country: string | null
    gate_code: string | null; parking_notes: string | null
    after_hours_phone: string | null; safety_notes: string | null
    latitude: number | null; longitude: number | null
  }
  const site = Array.isArray(check.sites)
    ? (check.sites[0] as SiteShape)
    : (check.sites as SiteShape | null)

  const jobPlanName = Array.isArray(check.job_plans)
    ? (check.job_plans[0] as { name: string } | undefined)?.name
    : (check.job_plans as { name: string } | null)?.name
  const checkTitle = check.custom_name ?? jobPlanName ?? 'Maintenance Check'

  // Tenant settings for branding + organizer email
  const settings = await getCachedTenantSettings(tenantId)
  const tenantName = settings?.report_company_name ?? settings?.product_name ?? 'EQ Solves Service'
  const primaryColour = settings?.primary_colour ?? '#3DA8D8'
  const organizerEmail = process.env.RESEND_FROM_EMAIL ?? 'contact@eq.solutions'

  // Count assets in this check
  const { count: assetCount } = await supabase
    .from('check_assets')
    .select('id', { count: 'exact', head: true })
    .eq('check_id', checkId)

  // Site primary contact — who the tech calls on arrival (brief block).
  const { data: contactRow } = await supabase
    .from('site_contacts')
    .select('name, role, phone, email')
    .eq('site_id', check.site_id as string)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle()
  const siteContact = contactRow
    ? {
        name: (contactRow as { name: string | null }).name ?? null,
        role: (contactRow as { role: string | null }).role ?? null,
        phone: (contactRow as { phone: string | null }).phone ?? null,
        email: (contactRow as { email: string | null }).email ?? null,
      }
    : null

  // Prior-visit summary — last completed check at this site (best-effort).
  let priorVisit:
    | { date: string; defectCount: number; failedItemCount: number; topDefects: string[] }
    | null = null
  const { data: lastCheck } = await supabase
    .from('maintenance_checks')
    .select('id, completed_at, due_date')
    .eq('site_id', check.site_id as string)
    .eq('status', 'complete')
    .neq('id', checkId)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (lastCheck?.id) {
    const [{ data: priorDefects }, { count: failedItemCount }] = await Promise.all([
      supabase
        .from('defects')
        .select('title')
        .eq('check_id', lastCheck.id as string)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('maintenance_check_items')
        .select('id', { count: 'exact', head: true })
        .eq('check_id', lastCheck.id as string)
        .eq('result', 'fail'),
    ])
    const { count: defectCount } = await supabase
      .from('defects')
      .select('id', { count: 'exact', head: true })
      .eq('check_id', lastCheck.id as string)
    priorVisit = {
      date: (lastCheck.completed_at as string | null) ?? (lastCheck.due_date as string | null) ?? '',
      defectCount: defectCount ?? 0,
      failedItemCount: failedItemCount ?? 0,
      topDefects: ((priorDefects ?? []) as { title: string | null }[])
        .map((d) => d.title)
        .filter((t): t is string => Boolean(t)),
    }
  }

  const appUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://service.eq.solutions'
  const checkUrl = `${appUrl}/maintenance/${checkId}`

  const addressLine = [site?.address, site?.city, site?.state].filter(Boolean).join(', ')
  const siteSummary = [site?.name, addressLine || null].filter(Boolean).join(' — ')

  // Attachments (run-sheet for this visit + last-visit report). Best-effort —
  // generation failure logs and skips, never blocks the brief. Reuses the same
  // builders the /api report routes use.
  const extraAttachments: { filename: string; content: Buffer }[] = []
  const siteLabel = site?.name ?? 'Site'
  try {
    const rsInput = await buildMaintenanceChecklistInput(supabase, checkId, tenantId, 'standard')
    if (rsInput) {
      const buf = await generateMaintenanceChecklist(rsInput)
      extraAttachments.push({ filename: `Run-Sheet - ${siteLabel}.docx`, content: Buffer.from(buf) })
    }
  } catch (e) {
    console.warn('[tech-brief] run-sheet attachment failed:', e)
  }
  if (lastCheck?.id) {
    try {
      const rptInput = await buildPmAssetReportInput(supabase, lastCheck.id as string, tenantId, 'standard')
      if (rptInput) {
        const buf = await generatePMAssetReport(rptInput)
        extraAttachments.push({ filename: `Last Visit Report - ${siteLabel}.docx`, content: Buffer.from(buf) })
      }
    } catch (e) {
      console.warn('[tech-brief] last-visit-report attachment failed:', e)
    }
  }

  // Build the .ics content
  const icsContent = buildIcs({
    uid: `eq-service-check-${checkId}@eq.solutions`,
    summary: `${checkTitle} — ${site?.name ?? 'Site'}`,
    description: `EQ Service maintenance check.\n\nAssets: ${assetCount ?? 0}\nOpen in app: ${checkUrl}`,
    location: addressLine || site?.name || undefined,
    startAt: scheduledStartAt,
    durationMinutes: 240,
    techEmail,
    techName,
    organizerEmail,
    organizerName: tenantName,
  })

  // Send the email
  const emailResult = await sendTechBriefEmail({
    to: techEmail,
    recipientName: techName,
    tenantName,
    primaryColour,
    checkTitle: `${checkTitle} — ${site?.name ?? 'Site'}`,
    siteName: site?.name ?? 'Site',
    siteAddress: site?.address ?? null,
    siteCity: site?.city ?? null,
    siteState: site?.state ?? null,
    gateCode: site?.gate_code ?? null,
    parkingNotes: site?.parking_notes ?? null,
    afterHoursPhone: site?.after_hours_phone ?? null,
    safetyNotes: site?.safety_notes ?? null,
    siteContact,
    priorVisit,
    scheduledStartAt,
    assetCount: assetCount ?? 0,
    checkUrl,
    icsContent,
    attachments: extraAttachments,
  })

  const emailSent = 'skipped' in emailResult ? false : true

  // Bell notification
  await createNotification({
    tenantId,
    userId: check.assigned_to as string,
    type: 'check_assigned',
    title: `Pre-visit brief sent: ${siteSummary}`,
    body: `Visit scheduled for ${new Date(scheduledStartAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`,
    entityType: 'maintenance_check',
    entityId: checkId,
  })

  await logAuditEvent({
    action: 'update',
    entityType: 'maintenance_check',
    entityId: checkId,
    summary: `Pre-visit brief sent to ${techName ?? techEmail} (${emailSent ? 'email+bell' : 'bell only — email skipped, RESEND_API_KEY not set'})`,
    mutationId: opts.mutationId ?? null,
    metadata: { tech_email: techEmail, scheduled_start_at: scheduledStartAt },
  })

  // Stamp the dedup gate so the cron won't re-send (column from migration 0121).
  if (opts.markSent) {
    await supabase
      .from('maintenance_checks')
      .update({ pre_visit_brief_sent_at: new Date().toISOString() })
      .eq('id', checkId)
  }

  return {
    success: true,
    emailSent,
    message: emailSent
      ? `Brief sent to ${techEmail} with .ics attachment.`
      : `Bell notification sent. Email skipped — RESEND_API_KEY is not set on this deployment.`,
  }
}
