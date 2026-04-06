'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { z } from 'zod'

const UpdateTenantSettingsSchema = z.object({
  product_name: z.string().min(1, 'Product name is required').max(100),
  primary_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  deep_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  ice_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  ink_colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour'),
  logo_url: z.string().max(500).nullable().optional(),
  support_email: z.string().email().nullable().optional(),
})

export async function updateTenantSettingsAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      product_name: formData.get('product_name'),
      primary_colour: formData.get('primary_colour'),
      deep_colour: formData.get('deep_colour'),
      ice_colour: formData.get('ice_colour'),
      ink_colour: formData.get('ink_colour'),
      logo_url: formData.get('logo_url') || null,
      support_email: formData.get('support_email') || null,
    }

    const parsed = UpdateTenantSettingsSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    const { error } = await supabase
      .from('tenant_settings')
      .update(parsed.data)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'tenant_settings', summary: 'Updated tenant settings' })
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
