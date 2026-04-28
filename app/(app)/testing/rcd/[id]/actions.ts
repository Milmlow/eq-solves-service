'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import {
  UpdateRcdCircuitsBatchSchema,
  UpdateRcdTestHeaderSchema,
} from '@/lib/validations/rcd-test'
import { propagateCheckCompletionIfReady } from '@/lib/actions/check-completion'

interface ActionOk {
  success: true
}
interface ActionErr {
  success: false
  error: string
}
type ActionResult = ActionOk | ActionErr

/**
 * Update the rcd_tests header (technician details, equipment, notes, status).
 *
 * Used by the onsite editor's "Save header" path. Status transitions to
 * 'complete' propagate to the linked maintenance_check (if any) so the
 * standard /maintenance dashboard reflects the work.
 */
export async function updateRcdTestHeaderAction(
  testId: string,
  raw: unknown,
): Promise<ActionResult> {
  try {
    const { supabase, role, user, tenantId } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const parsed = UpdateRcdTestHeaderSchema.safeParse(raw)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message }
    }

    const { data: existing } = await supabase
      .from('rcd_tests')
      .select('id, check_id, status')
      .eq('id', testId)
      .eq('is_active', true)
      .maybeSingle()
    if (!existing) return { success: false, error: 'RCD test not found.' }

    const goingToComplete =
      parsed.data.status === 'complete' && existing.status !== 'complete'

    const { error: updErr } = await supabase
      .from('rcd_tests')
      .update(parsed.data)
      .eq('id', testId)
    if (updErr) return { success: false, error: updErr.message }

    // Phase 4 (2026-04-28): use the shared propagation helper. The previous
    // inline logic was too eager — it propagated on the first complete RCD
    // test even when sibling tests under the same check were still draft.
    // The helper now requires every linked test (ACB + NSX + RCD) to be
    // complete before flipping the parent.
    if (goingToComplete && existing.check_id) {
      await propagateCheckCompletionIfReady(supabase, existing.check_id)
      revalidatePath(`/maintenance/${existing.check_id}`)
      revalidatePath('/maintenance')
    }

    await logAuditEvent({
      action: 'update',
      entityType: 'rcd_test',
      entityId: testId,
      summary: goingToComplete
        ? 'Marked RCD test complete (header save)'
        : 'Updated RCD test header',
      metadata: { tenantId, userId: user.id },
    })

    revalidatePath(`/testing/rcd/${testId}`)
    revalidatePath('/testing/rcd')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Batch-update circuit timing values, button check, and action notes.
 *
 * Field-tech save path: tech enters a board's worth of values onsite and
 * hits Save. Single round-trip per save (one update per circuit because
 * Supabase JS client doesn't expose UPDATE ... FROM (VALUES ...)).
 */
export async function updateRcdCircuitsAction(
  testId: string,
  raw: unknown,
): Promise<ActionResult & { updated?: number }> {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const parsed = UpdateRcdCircuitsBatchSchema.safeParse(raw)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message }
    }

    // Validate every circuit belongs to this test before mutating any of
    // them — prevents cross-test ID injection from a tampered payload.
    const ids = parsed.data.circuits.map((c) => c.id)
    const { data: owned } = await supabase
      .from('rcd_test_circuits')
      .select('id')
      .eq('rcd_test_id', testId)
      .in('id', ids)
    const ownedIds = new Set((owned ?? []).map((r) => r.id))
    const stranger = parsed.data.circuits.find((c) => !ownedIds.has(c.id))
    if (stranger) {
      return { success: false, error: 'One or more circuits do not belong to this test.' }
    }

    let updated = 0
    for (const c of parsed.data.circuits) {
      const { id, ...rest } = c
      const { error: updErr } = await supabase
        .from('rcd_test_circuits')
        .update(rest)
        .eq('id', id)
        .eq('rcd_test_id', testId)
      if (updErr) {
        return {
          success: false,
          error: `Failed to update circuit ${id}: ${updErr.message}`,
        }
      }
      updated++
    }

    await logAuditEvent({
      action: 'update',
      entityType: 'rcd_test',
      entityId: testId,
      summary: `Updated ${updated} RCD circuit value(s)`,
    })

    revalidatePath(`/testing/rcd/${testId}`)
    return { success: true, updated }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
