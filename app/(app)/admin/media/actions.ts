'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import type { MediaCategory } from '@/lib/types'

const MEDIA_MAX_SIZE = 2 * 1024 * 1024 // 2 MB
const MEDIA_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']

export async function uploadMediaAction(formData: FormData) {
  try {
    const { supabase, user, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const file = formData.get('file') as File | null
    const name = (formData.get('name') as string)?.trim()
    const category = (formData.get('category') as MediaCategory) ?? 'general'
    const entityType = (formData.get('entity_type') as string) || null
    const entityId = (formData.get('entity_id') as string) || null

    if (!file || file.size === 0) return { success: false, error: 'No file provided.' }
    if (!name) return { success: false, error: 'Name is required.' }
    if (file.size > MEDIA_MAX_SIZE) return { success: false, error: 'File exceeds 2 MB limit.' }
    if (!MEDIA_ALLOWED_TYPES.includes(file.type)) {
      return { success: false, error: 'File type not allowed. Use PNG, JPG, SVG, or WebP.' }
    }

    // Build storage path
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${tenantId}/media/${category}/${Date.now()}_${safeName}`

    // Upload to logos bucket (public)
    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(storagePath, file, { contentType: file.type, upsert: false })

    if (uploadError) return { success: false, error: uploadError.message }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('logos')
      .getPublicUrl(storagePath)

    const fileUrl = urlData?.publicUrl
    if (!fileUrl) return { success: false, error: 'Failed to get public URL.' }

    // Insert media record
    const { error: insertError } = await supabase
      .from('media_library')
      .insert({
        tenant_id: tenantId,
        name,
        category,
        entity_type: entityType,
        entity_id: entityId,
        file_url: fileUrl,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        uploaded_by: user.id,
      })

    if (insertError) return { success: false, error: insertError.message }

    await logAuditEvent({
      action: 'create',
      entityType: 'media',
      summary: `Uploaded media "${name}" (${category})`,
    })
    revalidatePath('/admin/media')
    return { success: true, fileUrl }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateMediaAction(id: string, data: { name?: string; category?: MediaCategory; entity_type?: string | null; entity_id?: string | null }) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('media_library')
      .update(data)
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'media',
      entityId: id,
      summary: `Updated media item`,
    })
    revalidatePath('/admin/media')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteMediaAction(id: string) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    // Soft delete
    const { error } = await supabase
      .from('media_library')
      .update({ is_active: false })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'delete',
      entityType: 'media',
      entityId: id,
      summary: 'Soft-deleted media item',
    })
    revalidatePath('/admin/media')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
