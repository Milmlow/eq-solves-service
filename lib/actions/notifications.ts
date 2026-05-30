'use server'

import { createAdminClient } from '@/lib/supabase/admin'

interface CreateNotificationParams {
  tenantId: string
  userId: string
  type: 'check_assigned' | 'check_overdue' | 'check_completed' | 'defect_raised'
  title: string
  body?: string
  entityType?: string
  entityId?: string
}

/**
 * Create a notification. Can be called from server actions.
 * Uses admin client to bypass RLS for system-generated notifications.
 */
export async function createNotification({
  tenantId,
  userId,
  type,
  title,
  body,
  entityType,
  entityId,
}: CreateNotificationParams) {
  try {
    const admin = createAdminClient()

    const { error } = await admin
      .from('notifications')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        type,
        title,
        body,
        entity_type: entityType,
        entity_id: entityId,
      })

    if (error) {
      console.error('Failed to create notification:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (e: unknown) {
    console.error('Error creating notification:', e)
    return { success: false, error: (e as Error).message }
  }
}
