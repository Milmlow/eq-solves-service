'use server'

import { createNotification } from '@/lib/actions/notifications'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Fan-out notifications when a defect is raised.
 *
 * Recipient policy:
 *   - severity='critical' → super_admin + admin + supervisor
 *   - else                → admin + supervisor
 *
 * Errors are swallowed — defect creation must not be blocked by a
 * notification failure. Used by:
 *   - app/(app)/maintenance/actions.ts → raiseDefectAction
 *   - app/(app)/acb-testing/actions.ts → raiseDefectFromAcbAction
 *   - app/(app)/nsx-testing/actions.ts → raiseDefectFromNsxAction
 */
export async function notifyDefectRaised(opts: {
  tenantId: string
  defectId: string
  title: string
  description?: string | null
  severity: string
}) {
  try {
    const recipientRoles: string[] = opts.severity === 'critical'
      ? ['super_admin', 'admin', 'supervisor']
      : ['admin', 'supervisor']

    // We use the admin client to fan-out — these notifications are
    // system-generated, not user-attributable. The notifications RLS
    // policy 'Service can insert notifications' allows service-role
    // insertion.
    const supabase = createAdminClient()
    const { data: recipients } = await supabase
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', opts.tenantId)
      .eq('is_active', true)
      .in('role', recipientRoles)

    const sevLabel = opts.severity === 'critical'
      ? 'CRITICAL'
      : (opts.severity ?? 'medium').toUpperCase()

    for (const r of (recipients ?? []) as Array<{ user_id: string }>) {
      await createNotification({
        tenantId: opts.tenantId,
        userId: r.user_id,
        type: 'defect_raised',
        title: `[${sevLabel}] Defect raised: ${opts.title}`,
        body: opts.description ?? undefined,
        entityType: 'defect',
        entityId: opts.defectId,
      })
    }
  } catch {
    // Quiet — never block the defect creation.
  }
}
