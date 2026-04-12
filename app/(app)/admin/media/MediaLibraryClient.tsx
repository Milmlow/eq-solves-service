'use client'

import { useState, useRef } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Upload, Trash2, Image as ImageIcon, Search, X } from 'lucide-react'
import { uploadMediaAction, deleteMediaAction, updateMediaAction } from './actions'
import type { MediaCategory } from '@/lib/types'

interface MediaItem {
  id: string
  name: string
  category: string
  entity_type: string | null
  entity_id: string | null
  file_url: string
  file_name: string
  content_type: string | null
  file_size: number | null
  created_at: string
}

interface Props {
  media: MediaItem[]
  customers: { id: string; name: string }[]
  sites: { id: string; name: string }[]
}

const CATEGORIES: { value: MediaCategory; label: string }[] = [
  { value: 'customer_logo', label: 'Customer Logo' },
  { value: 'site_photo', label: 'Site Photo' },
  { value: 'report_image', label: 'Report Image' },
  { value: 'general', label: 'General' },
]

export function MediaLibraryClient({ media: initialMedia, customers, sites }: Props) {
  const [media, setMedia] = useState(initialMedia)
  const [showUpload, setShowUpload] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [filterEntity, setFilterEntity] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')

  // Upload form state
  const [uploadName, setUploadName] = useState('')
  const [uploadCategory, setUploadCategory] = useState<MediaCategory>('general')
  const [uploadEntityType, setUploadEntityType] = useState<string>('')
  const [uploadEntityId, setUploadEntityId] = useState<string>('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Deleting state
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Filtered media
  const filtered = media.filter(item => {
    if (filterCategory && item.category !== filterCategory) return false
    if (filterEntity) {
      if (filterEntity.startsWith('customer:')) {
        if (item.entity_type !== 'customer' || item.entity_id !== filterEntity.replace('customer:', '')) return false
      } else if (filterEntity.startsWith('site:')) {
        if (item.entity_type !== 'site' || item.entity_id !== filterEntity.replace('site:', '')) return false
      }
    }
    if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase()) && !item.file_name.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  async function handleUpload() {
    if (!uploadFile || !uploadName.trim()) return
    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('name', uploadName.trim())
    formData.append('category', uploadCategory)
    if (uploadEntityType) formData.append('entity_type', uploadEntityType)
    if (uploadEntityId) formData.append('entity_id', uploadEntityId)

    const result = await uploadMediaAction(formData)
    setUploading(false)

    if (!result.success) {
      setUploadError(result.error ?? 'Upload failed.')
      return
    }

    // Reset form and refresh
    setUploadName('')
    setUploadCategory('general')
    setUploadEntityType('')
    setUploadEntityId('')
    setUploadFile(null)
    if (fileRef.current) fileRef.current.value = ''
    setShowUpload(false)

    // Optimistic: add to local state (will be refreshed on next server load)
    window.location.reload()
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this image from the media library?')) return
    setDeletingId(id)
    const result = await deleteMediaAction(id)
    setDeletingId(null)
    if (result.success) {
      setMedia(prev => prev.filter(m => m.id !== id))
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const entityOptions = [
    ...customers.map(c => ({ value: `customer:${c.id}`, label: `Customer: ${c.name}`, type: 'customer', id: c.id })),
    ...sites.map(s => ({ value: `site:${s.id}`, label: `Site: ${s.name}`, type: 'site', id: s.id })),
  ]

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-eq-grey" />
            <input
              type="text"
              placeholder="Search images…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
            />
          </div>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-eq-sky"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={filterEntity}
            onChange={e => setFilterEntity(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-eq-sky"
          >
            <option value="">All Entities</option>
            {entityOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={() => setShowUpload(!showUpload)}>
          <Upload className="w-3 h-3 mr-1" /> Upload
        </Button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <Card className="border-eq-sky">
          <h3 className="text-sm font-bold text-eq-ink mb-3">Upload New Image</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Name *</label>
              <input
                type="text"
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                placeholder="e.g. Equinix Logo, SY1 Front Entrance"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Category</label>
              <select
                value={uploadCategory}
                onChange={e => {
                  const cat = e.target.value as MediaCategory
                  setUploadCategory(cat)
                  // Auto-set entity type from category
                  if (cat === 'customer_logo') setUploadEntityType('customer')
                  else if (cat === 'site_photo') setUploadEntityType('site')
                  else setUploadEntityType('')
                }}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {(uploadCategory === 'customer_logo' || uploadEntityType === 'customer') && (
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Customer</label>
                <select
                  value={uploadEntityId}
                  onChange={e => { setUploadEntityType('customer'); setUploadEntityId(e.target.value) }}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                >
                  <option value="">Select customer…</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {(uploadCategory === 'site_photo' || uploadEntityType === 'site') && (
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Site</label>
                <select
                  value={uploadEntityId}
                  onChange={e => { setUploadEntityType('site'); setUploadEntityId(e.target.value) }}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                >
                  <option value="">Select site…</option>
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Image File *</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm file:mr-2 file:py-1 file:px-3 file:rounded-md file:border file:border-gray-200 file:text-xs file:font-medium file:bg-white file:text-eq-deep hover:file:bg-eq-ice"
              />
              <p className="text-xs text-eq-grey mt-0.5">PNG, JPG, SVG, WebP. Max 2 MB.</p>
            </div>
          </div>
          {uploadError && (
            <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
              <X className="w-3 h-3" /> {uploadError}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" disabled={uploading || !uploadFile || !uploadName.trim()} onClick={handleUpload}>
              {uploading ? 'Uploading…' : 'Upload Image'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowUpload(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Media grid */}
      {filtered.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <ImageIcon className="w-10 h-10 text-eq-grey mx-auto mb-2 opacity-40" />
            <p className="text-sm text-eq-grey">
              {media.length === 0 ? 'No images uploaded yet. Click Upload to get started.' : 'No images match your filters.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(item => (
            <Card key={item.id} className="p-0 overflow-hidden group relative">
              {/* Image preview */}
              <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
                {item.content_type?.startsWith('image/svg') ? (
                  <img src={item.file_url} alt={item.name} className="max-w-full max-h-full object-contain p-2" />
                ) : (
                  <img src={item.file_url} alt={item.name} className="w-full h-full object-cover" />
                )}
              </div>

              {/* Info */}
              <div className="p-2">
                <p className="text-xs font-medium text-eq-ink truncate" title={item.name}>{item.name}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-eq-ice text-eq-deep font-medium">
                    {CATEGORIES.find(c => c.value === item.category)?.label ?? item.category}
                  </span>
                  <span className="text-[10px] text-eq-grey">{formatSize(item.file_size)}</span>
                </div>
                {item.entity_type && item.entity_id && (
                  <p className="text-[10px] text-eq-grey mt-1 truncate">
                    {item.entity_type === 'customer'
                      ? customers.find(c => c.id === item.entity_id)?.name ?? 'Unknown'
                      : sites.find(s => s.id === item.entity_id)?.name ?? 'Unknown'}
                  </p>
                )}
              </div>

              {/* Delete overlay */}
              <button
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                className="absolute top-1.5 right-1.5 p-1 rounded-md bg-white/80 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <p className="text-xs text-eq-grey text-right">
        {filtered.length} of {media.length} image{media.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
