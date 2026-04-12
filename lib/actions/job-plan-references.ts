'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { withIdempotency } from '@/lib/actions/idempotency'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const BUCKET = 'job-plan-references'

/**
 * Upload a reference image for a job plan item. Admin-only.
 * Stored in the public `job-plan-references` bucket at
 *   {tenant_id}/{job_plan_item_id}/{timestamp}_{filename}
 * The resulting public URL is saved to `job_plan_items.reference_image_url`
 * so the client can render it without a signed-URL round trip.
 *
 * Replay-safe — accepts an optional `mutationId`.
 */
export async function uploadJobPlanItemReferenceAction(
  itemId: string,
  formData: FormData,
  mutationId?: string,
) {
  return withIdempotency(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const file = formData.get('file') as File | null
    const caption = (formData.get('caption') as string | null)?.trim() || null
    if (!file || file.size === 0) return { success: false, error: 'No file provided.' }
    if (file.size > MAX_BYTES) return { success: false, error: 'File exceeds 5 MB limit.' }
    if (!ALLOWED.includes(file.type)) {
      return { success: false, error: `File type "${file.type}" not allowed. Use JPEG, PNG, or WebP.` }
    }

    // Verify the item exists under this tenant (RLS will also enforce this,
    // but an explicit check gives a cleaner error).
    const { data: item } = await supabase
      .from('job_plan_items')
      .select('id, tenant_id, reference_image_url')
      .eq('id', itemId)
      .single()
    if (!item) return { success: false, error: 'Job plan item not found.' }
    if (item.tenant_id !== tenantId) return { success: false, error: 'Forbidden.' }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${tenantId}/${itemId}/${Date.now()}_${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false })

    if (uploadError) return { success: false, error: uploadError.message }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
    const publicUrl = publicUrlData.publicUrl

    // Update the master row
    const { error: dbError } = await supabase
      .from('job_plan_items')
      .update({
        reference_image_url: publicUrl,
        reference_image_caption: caption,
      })
      .eq('id', itemId)

    if (dbError) {
      // Cleanup storage on DB failure
      await supabase.storage.from(BUCKET).remove([storagePath])
      return { success: false, error: dbError.message }
    }

    // Best-effort cleanup of the previous image if this was a replace.
    // We parse the old public URL to get the storage path and ignore failures.
    if (item.reference_image_url) {
      const oldPath = extractStoragePath(item.reference_image_url, BUCKET)
      if (oldPath && oldPath !== storagePath) {
        await supabase.storage.from(BUCKET).remove([oldPath])
      }
    }

    await logAuditEvent({
      action: 'update',
      entityType: 'job_plan_item',
      entityId: itemId,
      summary: 'Reference image uploaded',
      metadata: { storage_path: storagePath, caption },
      mutationId,
    })

    revalidatePath('/job-plans')
    return { success: true }
  })
}

/**
 * Remove the reference image from a job plan item. Admin-only.
 * Deletes the storage object then clears the DB columns.
 */
export async function clearJobPlanItemReferenceAction(
  itemId: string,
  mutationId?: string,
) {
  return withIdempotency(mutationId, async () => {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin access required.' }

    const { data: item } = await supabase
      .from('job_plan_items')
      .select('id, tenant_id, reference_image_url')
      .eq('id', itemId)
      .single()
    if (!item) return { success: false, error: 'Job plan item not found.' }
    if (item.tenant_id !== tenantId) return { success: false, error: 'Forbidden.' }

    if (item.reference_image_url) {
      const oldPath = extractStoragePath(item.reference_image_url, BUCKET)
      if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath])
    }

    const { error: dbError } = await supabase
      .from('job_plan_items')
      .update({ reference_image_url: null, reference_image_caption: null })
      .eq('id', itemId)

    if (dbError) return { success: false, error: dbError.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'job_plan_item',
      entityId: itemId,
      summary: 'Reference image cleared',
      mutationId,
    })

    revalidatePath('/job-plans')
    return { success: true }
  })
}

/**
 * Pulls the object key out of a Supabase public URL.
 * Example in : https://x.supabase.co/storage/v1/object/public/job-plan-references/TENANT/ITEM/123_img.jpg
 * Example out: TENANT/ITEM/123_img.jpg
 * Returns null if the URL does not contain the expected bucket segment —
 * defensive, since we do not want to accidentally delete arbitrary paths.
 */
function extractStoragePath(publicUrl: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  return publicUrl.slice(idx + marker.length)
}
