'use client'

import { useState, useTransition } from 'react'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { ImageThumbnail } from '@/components/ui/ImageThumbnail'
import {
  uploadJobPlanItemReferenceAction,
  clearJobPlanItemReferenceAction,
} from '@/lib/actions/job-plan-references'

interface Props {
  itemId: string
  imageUrl: string | null
  caption: string | null
  disabled?: boolean
}

/**
 * Admin-facing reference image control for a job plan item row.
 * Renders a thumbnail (if set), an upload/replace picker, a caption
 * input (only shown when an image exists), and a clear button.
 *
 * Uses useTransition so the parent list revalidates automatically
 * after a successful upload/clear without this component managing
 * local state — the new URL and caption come back via props on the
 * next server render.
 */
export function JobPlanItemImageControl({ itemId, imageUrl, caption, disabled }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [localCaption, setLocalCaption] = useState(caption ?? '')

  async function handleUpload(file: File): Promise<{ success: boolean; error?: string }> {
    setError(null)
    const formData = new FormData()
    formData.set('file', file)
    formData.set('caption', localCaption)
    const result = await uploadJobPlanItemReferenceAction(itemId, formData)
    if (!result.success) {
      setError(result.error)
      return { success: false, error: result.error }
    }
    return { success: true }
  }

  function handleClear() {
    if (!confirm('Remove this reference image?')) return
    setError(null)
    startTransition(async () => {
      const result = await clearJobPlanItemReferenceAction(itemId)
      if (!result.success) setError(result.error ?? 'Clear failed.')
      else setLocalCaption('')
    })
  }

  return (
    <div className="flex items-center gap-2 mt-1">
      {imageUrl ? (
        <>
          <ImageThumbnail src={imageUrl} caption={caption} size="sm" />
          <input
            type="text"
            value={localCaption}
            onChange={(e) => setLocalCaption(e.target.value)}
            onBlur={() => {
              // Re-upload the same image URL only if the caption changed.
              // Keeping this simple for now — caption edits require a replace.
            }}
            placeholder="Caption (set on next upload)"
            className="h-7 px-2 text-xs border border-gray-200 rounded bg-white flex-1 max-w-xs"
            disabled={disabled || pending}
          />
          <ImageUpload
            label="Replace"
            disabled={disabled || pending}
            onUpload={handleUpload}
          />
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled || pending}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            Clear
          </button>
        </>
      ) : (
        <>
          <input
            type="text"
            value={localCaption}
            onChange={(e) => setLocalCaption(e.target.value)}
            placeholder="Optional caption"
            className="h-7 px-2 text-xs border border-gray-200 rounded bg-white max-w-xs"
            disabled={disabled || pending}
          />
          <ImageUpload
            label="Add image"
            disabled={disabled || pending}
            onUpload={handleUpload}
          />
        </>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
