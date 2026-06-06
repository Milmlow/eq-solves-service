'use server'

/**
 * Tech brief server actions for /maintenance/[id].
 *
 * Feature: Pre-visit tech brief (docs/runbooks/pre-visit-tech-brief-spec.md).
 *
 * Two actions:
 *   1. updateCheckScheduledStartAction — inline date-time editor (+ Phase 2
 *      reschedule reset of the brief-sent gate)
 *   2. sendTechBriefAction             — manual "Send brief" button
 *
 * The brief composition itself lives in lib/notifications/send-pre-visit-brief.ts
 * so the day-before cron can reuse it verbatim.
 */

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite } from '@/lib/utils/roles'
import { withIdempotency, type ActionResult } from '@/lib/actions/idempotency'
import { composeAndSendPreVisitBrief } from '@/lib/notifications/send-pre-visit-brief'

/**
 * Save the scheduled_start_at for a maintenance check.
 *
 * Called by the inline date-time editor on /maintenance/[id]. Only supervisor+
 * can set the start time — same gate as setting scheduled status.
 *
 * Phase 2 reschedule handling: if a brief was already sent for this check and
 * the start time moves by more than 1 hour, the brief-sent gate is cleared so
 * the day-before cron re-fires for the new time.
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

    // Read the prior values so we can detect a >1hr reschedule below.
    const { data: existing } = await supabase
      .from('maintenance_checks')
      .select('scheduled_start_at, pre_visit_brief_sent_at')
      .eq('id', checkId)
      .maybeSingle()
    const ex = existing as { scheduled_start_at?: string | null; pre_visit_brief_sent_at?: string | null } | null

    const { error } = await supabase
      .from('maintenance_checks')
      .update({ scheduled_start_at: scheduledStartAt })
      .eq('id', checkId)

    if (error) return { success: false, error: error.message }

    // Reschedule: a brief already went out AND the start moved >1hr → clear the
    // sent gate so the cron re-sends for the new time (column added migration
    // 0121; database.types.ts not yet regenerated — cast).
    if (ex?.pre_visit_brief_sent_at && ex.scheduled_start_at && scheduledStartAt) {
      const diffMinutes = Math.abs(
        new Date(scheduledStartAt).getTime() - new Date(ex.scheduled_start_at).getTime(),
      ) / 60000
      if (diffMinutes > 60) {
        await supabase
          .from('maintenance_checks')
          .update({ pre_visit_brief_sent_at: null })
          .eq('id', checkId)
      }
    }

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
 * Send the pre-visit tech brief to the assigned technician (manual button).
 *
 * Replay-safe (AGENTS.md): accepts an optional `mutationId`. The Send-brief
 * button passes a stable id (reset per successful send) so a double-click
 * dedupes via the audit unique index instead of double-firing the email.
 * Composition + send is shared with the cron via composeAndSendPreVisitBrief.
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

    const result = await composeAndSendPreVisitBrief(supabase, checkId, tenantId, {
      mutationId,
      markSent: true,
    })

    if (!result.success) {
      return { success: false as const, error: result.error }
    }

    revalidatePath(`/maintenance/${checkId}`)
    return { success: true as const, data: { message: result.message } }
  })
}
