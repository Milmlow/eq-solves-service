'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Image as ImageIcon, ChevronDown } from 'lucide-react'
import type { MediaCategory } from '@/lib/types'

interface MediaPickerProps {
  /** Currently selected media URL (controls the preview) */
  value: string | null
  /** Callback when user picks an image — receives the file_url */
  onChange: (url: string | null) => void
  /** Filter by category */
  category?: MediaCategory
  /** Filter by entity type + id */
  entityType?: 'customer' | 'site'
  entityId?: string
  /** Placeholder text */
  placeholder?: string
  /** Disable the picker */
  disabled?: boolean
  /** Label for the field */
  label?: string
}

interface MediaOption {
  id: string
  name: string
  file_url: string
  category: string
  content_type: string | null
}

/**
 * Reusable dropdown picker that references images from the centralized media library.
 * Use on customer forms, site forms, report settings, etc. — single source of truth.
 */
export function MediaPicker({
  value,
  onChange,
  category,
  entityType,
  entityId,
  placeholder = 'Select an image…',
  disabled = false,
  label,
}: MediaPickerProps) {
  const [options, setOptions] = useState<MediaOption[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  // Fetch media options on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const supabase = createClient()
      let query = supabase
        .from('media_library')
        .select('id, name, file_url, category, content_type')
        .eq('is_active', true)
        .order('name')

      if (category) query = query.eq('category', category)
      if (entityType) query = query.eq('entity_type', entityType)
      if (entityId) query = query.eq('entity_id', entityId)

      const { data } = await query
      if (!cancelled) {
        setOptions(data ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [category, entityType, entityId])

  const selected = options.find(o => o.file_url === value)

  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-eq-grey">{label}</label>}

      <div className="relative">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-left focus:outline-none focus:ring-2 focus:ring-eq-sky disabled:opacity-50"
        >
          {selected ? (
            <>
              <img
                src={selected.file_url}
                alt={selected.name}
                className="w-6 h-6 rounded object-cover flex-shrink-0"
              />
              <span className="truncate flex-1 text-eq-ink">{selected.name}</span>
            </>
          ) : (
            <>
              <ImageIcon className="w-4 h-4 text-eq-grey flex-shrink-0" />
              <span className="truncate flex-1 text-eq-grey">{loading ? 'Loading…' : placeholder}</span>
            </>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-eq-grey flex-shrink-0" />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {/* Clear option */}
            <button
              type="button"
              className="w-full px-3 py-2 text-xs text-eq-grey hover:bg-gray-50 text-left border-b border-gray-100"
              onClick={() => { onChange(null); setOpen(false) }}
            >
              Clear selection
            </button>

            {options.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-eq-grey">
                No images available. Upload via Admin → Media Library.
              </div>
            ) : (
              options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-eq-ice text-left ${
                    opt.file_url === value ? 'bg-eq-ice' : ''
                  }`}
                  onClick={() => { onChange(opt.file_url); setOpen(false) }}
                >
                  <img
                    src={opt.file_url}
                    alt={opt.name}
                    className="w-8 h-8 rounded object-cover flex-shrink-0 border border-gray-100"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-eq-ink truncate">{opt.name}</p>
                    <p className="text-[10px] text-eq-grey">{opt.category.replace('_', ' ')}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Preview */}
      {value && selected && (
        <div className="mt-1">
          <img
            src={value}
            alt={selected.name}
            className="w-16 h-16 rounded-md object-cover border border-gray-200"
          />
        </div>
      )}
    </div>
  )
}
