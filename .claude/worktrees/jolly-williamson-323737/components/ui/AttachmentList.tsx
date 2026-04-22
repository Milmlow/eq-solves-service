'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { uploadAttachmentAction, deleteAttachmentAction, getAttachmentUrlAction } from '@/lib/actions/attachments'
import type { Attachment } from '@/lib/types'
import { Paperclip, Upload, Trash2, Download, FileText, Image, FileSpreadsheet } from 'lucide-react'

interface AttachmentListProps {
  entityType: string
  entityId: string
  attachments: Attachment[]
  canWrite: boolean
  isAdmin: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/')) return <Image className="w-4 h-4 text-eq-sky" />
  if (contentType === 'application/pdf') return <FileText className="w-4 h-4 text-red-500" />
  if (contentType.includes('spreadsheet') || contentType === 'text/csv') return <FileSpreadsheet className="w-4 h-4 text-green-600" />
  return <FileText className="w-4 h-4 text-eq-grey" />
}

export function AttachmentList({ entityType, entityId, attachments, canWrite: canWriteRole, isAdmin: isAdminRole }: AttachmentListProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setUploading(true)

    const formData = new FormData()
    formData.set('file', file)
    const result = await uploadAttachmentAction(entityType, entityId, formData)

    setUploading(false)
    if (!result.success) setError(result.error ?? 'Upload failed.')
    // Reset file input
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDownload(attachment: Attachment) {
    const result = await getAttachmentUrlAction(attachment.storage_path)
    if (result.success && result.url) {
      window.open(result.url, '_blank')
    }
  }

  async function handleDelete(attachmentId: string) {
    if (!confirm('Delete this attachment?')) return
    const result = await deleteAttachmentAction(attachmentId)
    if (!result.success) setError(result.error ?? 'Delete failed.')
  }

  return (
    <div className="pt-4 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5" />
          Attachments ({attachments.length})
        </h3>
        {canWriteRole && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx,.csv,.txt"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 text-xs text-eq-sky hover:text-eq-deep transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {attachments.length === 0 ? (
        <p className="text-sm text-eq-grey">No attachments.</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center justify-between p-2.5 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <FileIcon contentType={att.content_type} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-eq-ink truncate">{att.file_name}</p>
                  <p className="text-xs text-eq-grey">{formatFileSize(att.file_size)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handleDownload(att)}
                  className="p-1.5 rounded text-eq-grey hover:text-eq-sky transition-colors"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {isAdminRole && (
                  <button
                    onClick={() => handleDelete(att.id)}
                    className="p-1.5 rounded text-gray-300 hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
