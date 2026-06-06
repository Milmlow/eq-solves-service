'use server'

/**
 * Tech brief server actions for /maintenance/[id].
 *
 * Feature: Pre-visit tech brief Phase 1
 * Spec: docs/runbooks/pre-visit-tech-brief-spec.md
 *
 * Two actions:
 *   1. updateCheckScheduledStartAction — inline date-time editor
 *   2. sendTechBriefAction             — manual "Send brief" button
 *
 * No new migrations needed: scheduled_start_at column was added in
 * migration 0096 (Phase 0, already shipped).
 */

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite } from '@/lib/utils/roles'
import { createNotification } from '@/lib/actions/notifications'
import { sendTechBriefEmail } from '@/lib/email/send-tech-brief'
import { buildIcs } from '@/lib/utils/build-ics'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'

/**
 * Save the scheduled_start_at for a maintenance check.
 *
 * Called by the inline date-time editor on /maintenance/[id].
 * Only supervisor+ can set the start time — same gate as
 * setting scheduled status.
 */
export async function updateCheckScheduledStartAction(
  checkId: string,
  scheduledStartAt: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const { supabase, role } = await requireUser()

    if (!canWrite(role)) {
      return { success: false, error: 'Insufficient permissions.' }
    }

    // Validate ISO 8601 if provided
    if (scheduledStartAt !== null) {
      const d = new Date(scheduledStartAt)
      if (isNaN(d.getTime())) {
        return { success: false, error: 'Invalid date-time value.' }
      }
    }

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ scheduled_start_at: scheduledStartAt })
      .eq('id', checkId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'maintenance_check',
      entityId: checkId,
      summary: scheduledStartAt
        ? `Set scheduled start to ${scheduledStartAt}`
        : 'Cleared scheduled start time',
    })

    revalidatePath(`/maintenance/${checkId}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Send the pre-visit tech brief to the assigned technician.
 *
 * Sends:
 *   - Resend email with .ics attachment
 *   - In-app bell notification
 *
 * Requires:
 *   - admin/supervisor role
 *   - check has an assigned_to technician with a profile email
 *   - check has scheduled_start_at set (falls back to 08:00 local if absent)
 *
 * Replay-safe (AGENTS.md): accepts an optional `mutationId`. The Send-brief
 * button passes a stable id (reset per successful send) so a double-click
 * dedupes via the audit unique index instead of double-firing the email.
 * An intentional resend (after the result shows) uses a fresh id. Does not
 * gate on pre_visit_brief_sent_at — that column is Phase 2 for the cron.
 */
export async function sendTechBriefAction(
  checkId: string,
  mutationId?: string | null,
): Promise<ActionResult<{ message: string }>> {
  return withIdempotency(mutationId ?? null, async () => {
    const { supabase, tenantId, role } = await requireUser()

    if (!canWrite(role)) {
      return { success: false as const, error: 'Insufficient permissions — supervisor or admin required.' }
    }

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
      return { success: false as const, error: 'Check not found.' }
    }

    if (!check.assigned_to) {
      return { success: false as const, error: 'No technician assigned. Assign a technician before sending the brief.' }
    }

    // Resolve tech profile (name + email)
    const { data: techProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', check.assigned_to as string)
      .maybeSingle()

    const techEmail = (techProfile as { full_name?: string | null; email?: string | null } | null)?.email
    if (!techEmail) {
      return { success: false as const, error: 'Assigned technician has no email address on their profile.' }
    }
    const techName = (techProfile as { full_name?: string | null } | null)?.full_name ?? null

    // Resolve scheduled_start_at — fall back to 08:00 on due_date if unset
    const rawStart = (check as unknown as { scheduled_start_at?: string | null }).scheduled_start_at
    let scheduledStartAt: string
    if (rawStart) {
      scheduledStartAt = rawStart
    } else if (check.due_date) {
      // Fall back to 08:00 on the due date in local ISO format
      scheduledStartAt = `${check.due_date}T08:00:00`
    } else {
      return { success: false as const, error: 'No scheduled start time or due date is set on this check.' }
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

    // Prior-visit summary — the last completed check at this site, with what
    // it turned up (defects raised + items failed). Gives the tech context on
    // what to expect / re-check. Best-effort; absence just omits the block.
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
      'https://eq-solves-service.netlify.app'
    const checkUrl = `${appUrl}/maintenance/${checkId}`

    const addressLine = [site?.address, site?.city, site?.state]
      .filter(Boolean)
      .join(', ')

    const siteSummary = [
      site?.name,
      addressLine || null,
    ].filter(Boolean).join(' — ')

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
    })

    const emailSent = 'skipped' in emailResult ? false : true

    // Bell notification — always (no opt-out check in Phase 1)
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
      mutationId: mutationId ?? null,
      metadata: { tech_email: techEmail, scheduled_start_at: scheduledStartAt },
    })

    revalidatePath(`/maintenance/${checkId}`)

    return {
      success: true as const,
      data: {
        message: emailSent
          ? `Brief sent to ${techEmail} with .ics attachment.`
          : `Bell notification sent. Email skipped — RESEND_API_KEY is not set on this deployment.`,
      },
    }
  })
}
