'use client'

import { useState, useRef } from 'react'
import { uploadAttachmentAction, deleteAttachmentAction, getAttachmentUrlAction } from '@/lib/actions/attachments'
import type { Attachment, AttachmentType } from '@/lib/types'
import { Paperclip, Upload, Trash2, Download, FileText, Image, FileSpreadsheet, Camera, BookOpen, Receipt } from 'lucide-react'

interface AttachmentListProps {
  entityType: string
  entityId: string
  attachments: Attachment[]
  canWrite: boolean
  isAdmin: boolean
  /**
   * Optional whitelist — restrict which attachment types can be uploaded
   * here. e.g. on a Site detail page you might only allow 'reference'.
   * Defaults to all three types.
   */
  allowedTypes?: AttachmentType[]
  /**
   * Optional default — pre-selects this type in the picker. When omitted,
   * the modal infers from entityType server-side.
   */
  defaultType?: AttachmentType
}

const TYPE_META: Record<AttachmentType, { label: string; description: string; icon: typeof Camera }> = {
  evidence: {
    label: 'Evidence',
    description: 'Photos / videos for tests + defects. Shown on PDF reports.',
    icon: Camera,
  },
  reference: {
    label: 'Reference',
    description: 'SLDs, drawings, manuals. Pinned to the site for techs.',
    icon: BookOpen,
  },
  paperwork: {
    label: 'Paperwork',
    description: 'POs, signoffs, dockets on work orders. Internal only.',
    icon: Receipt,
  },
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

function inferDefaultType(entityType: string): AttachmentType {
  if (entityType === 'site' || entityType === 'asset') return 'reference'
  if (entityType === 'work_order' || entityType.startsWith('wo_')) return 'paperwork'
  return 'evidence'
}

export function AttachmentList({
  entityType,
  entityId,
  attachments,
  canWrite: canWriteRole,
  isAdmin: isAdminRole,
  allowedTypes,
  defaultType,
}: AttachmentListProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const types: AttachmentType[] = allowedTypes ?? ['evidence', 'reference', 'paperwork']
  const initialType: AttachmentType = defaultType ?? (types.includes(inferDefaultType(entityType))
    ? inferDefaultType(entityType)
    : types[0])
  const [pendingType, setPendingType] = useState<AttachmentType>(initialType)
  const [showTypePrompt, setShowTypePrompt] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    // If the user only has one type allowed (e.g. on a Site page), skip the
    // picker — there's no choice to make.
    if (types.length === 1) {
      void doUpload(file, types[0])
      return
    }
    setPendingFile(file)
    setShowTypePrompt(true)
  }

  async function doUpload(file: File, type: AttachmentType) {
    setUploading(true)
    const formData = new FormData()
    formData.set('file', file)
    formData.set('attachment_type', type)
    const result = await uploadAttachmentAction(entityType, entityId, formData)
    setUploading(false)
    setShowTypePrompt(false)
    setPendingFile(null)
    if (!result.success) setError(result.error ?? 'Upload failed.')
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
              onChange={handlePickFile}
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

      {/* Type picker — modal-lite. Appears between file pick and upload. */}
      {showTypePrompt && pendingFile && (
        <div className="mb-3 p-3 border border-eq-sky/30 bg-eq-ice/40 rounded-md">
          <p className="text-xs font-semibold text-eq-ink mb-2">
            What kind of attachment is <span className="font-mono">{pendingFile.name}</span>?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            {types.map((t) => {
              const meta = TYPE_META[t]
              const Icon = meta.icon
              const selected = pendingType === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPendingType(t)}
                  className={
                    'text-left p-2.5 border rounded-md transition-colors ' +
                    (selected
                      ? 'border-eq-sky bg-white'
                      : 'border-gray-200 bg-white hover:border-eq-sky/50')
                  }
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={'w-3.5 h-3.5 ' + (selected ? 'text-eq-sky' : 'text-eq-grey')} />
                    <span className={'text-xs font-semibold ' + (selected ? 'text-eq-deep' : 'text-eq-ink')}>{meta.label}</span>
                  </div>
                  <p className="text-[11px] text-eq-grey leading-snug">{meta.description}</p>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setShowTypePrompt(false); setPendingFile(null); if (fileRef.current) fileRef.current.value = '' }}
              disabled={uploading}
              className="text-xs text-eq-grey hover:text-eq-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => pendingFile && doUpload(pendingFile, pendingType)}
              disabled={uploading}
              className="text-xs font-semibold bg-eq-sky text-white px-3 py-1.5 rounded hover:bg-eq-deep transition-colors disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-eq-grey">No attachments.</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((att) => {
            const TypeIcon = TYPE_META[att.attachment_type]?.icon ?? FileText
            return (
              <div key={att.id} className="flex items-center justify-between p-2.5 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <FileIcon contentType={att.content_type} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-eq-ink truncate">{att.file_name}</p>
                    <p className="text-xs text-eq-grey flex items-center gap-1.5">
                      <TypeIcon className="w-3 h-3" />
                      <span className="capitalize">{att.attachment_type}</span>
                      <span className="text-gray-300">·</span>
                      {formatFileSize(att.file_size)}
                    </p>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
