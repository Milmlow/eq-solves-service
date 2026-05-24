'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'

/**
 * Dismiss the technician first-login welcome card on the current tenant.
 *
 * Stamps `tenant_members.tech_onboarded_at` = now() for the current
 * (user_id, tenant_id) pair. After this the TechDashboard stops
 * rendering the welcome surface — see PR I in the UX audit PR slicing.
 *
 * Idempotent — re-calling on an already-stamped row is a no-op (the
 * timestamp moves forward but the UI doesn't care).
 */
export async function dismissTechWelcomeAction() {
  try {
    const { supabase, tenantId, user } = await requireUser()

    const { error } = await supabase
      .from('tenant_members')
      .update({ tech_onboarded_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)

    if (error) return { success: false as const, error: error.message }

    revalidatePath('/dashboard')
    return { success: true as const }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}

/**
 * Dismiss the admin dashboard onboarding checklist on the current tenant.
 *
 * Stamps `tenant_members.setup_checklist_dismissed_at` = now() for the
 * current (user_id, tenant_id) pair. After this the dashboard renders the
 * normal KPI view with a thin "Setup N/7" chip above it instead of the
 * full checklist. The chip links to /dashboard?setup=show which force-shows
 * the checklist again without clearing the column — see page.tsx branching.
 *
 * Idempotent — re-calling on an already-stamped row just moves the
 * timestamp forward, which the UI doesn't care about.
 */
export async function dismissSetupChecklistAction() {
  try {
    const { supabase, tenantId, user } = await requireUser()

    const { error } = await supabase
      .from('tenant_members')
      .update({ setup_checklist_dismissed_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)

    if (error) return { success: false as const, error: error.message }

    revalidatePath('/dashboard')
    return { success: true as const }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}

/**
 * Clear the dismissal stamp so the dashboard goes back to rendering the
 * full onboarding checklist by default. Used by the "Pin checklist back"
 * action inside the checklist (when shown via ?setup=show); the chip
 * itself just deep-links to ?setup=show without clearing the column, so
 * casual re-opens don't mutate state.
 */
export async function restoreSetupChecklistAction() {
  try {
    const { supabase, tenantId, user } = await requireUser()

    const { error } = await supabase
      .from('tenant_members')
      .update({ setup_checklist_dismissed_at: null })
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)

    if (error) return { success: false as const, error: error.message }

    revalidatePath('/dashboard')
    return { success: true as const }
  } catch (e: unknown) {
    return { success: false as const, error: (e as Error).message }
  }
}
