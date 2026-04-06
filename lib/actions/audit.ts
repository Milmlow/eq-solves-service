'use server'

import { requireUser } from '@/lib/actions/auth'

/**
 * Log an audit event. Called from other server actions after successful mutations.
 * Silently fails — audit logging should never block the primary action.
 */
export async function logAuditEvent(opts: {
  action: string
  entityType: string
  entityId?: string | null
  summary?: string
  metadata?: Record<string, unknown>
}) {
  try {
    const { supabase, tenantId, user } = await requireUser()
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: user.id,
      action: opts.action,
      entity_type: opts.entityType,
      entity_id: opts.entityId ?? null,
      summary: opts.summary ?? null,
      metadata: opts.metadata ?? {},
    })
  } catch {
    // Silently fail — audit should not break primary operations
  }
}
