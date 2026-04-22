'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils/format'
import { Download, ClipboardPaste } from 'lucide-react'
import type { MaintenanceCheck, CheckStatus } from '@/lib/types'
import { ReportDownloadDialog } from '@/components/ui/ReportDownloadDialog'
import type { ReportComplexity } from '@/components/ui/ReportDownloadDialog'
import { events as analyticsEvents } from '@/lib/analytics'

function statusToBadge(status: CheckStatus) {
  const map: Record<CheckStatus, 'not-started' | 'in-progress' | 'complete' | 'cancelled' | 'overdue'> = {
    scheduled: 'not-started',
    in_progress: 'in-progress',
    complete: 'complete',
    cancelled: 'cancelled',
    overdue: 'overdue',
  }
  return map[status]
}

interface CheckHeaderProps {
  check: MaintenanceCheck & {
    sites?: { name: string } | null
    assignee_name?: string | null
  }
  completedCount: number
  totalCount: number
  requiredIncomplete: number
  error: string | null
  loading: boolean
  canAct: boolean
  isAdmin: boolean
  onStart: () => void
  onComplete: () => void
  onDelete: () => void
  onPasteWOs: (lines: string) => Promise<void>
  onForceStatus?: (status: CheckStatus) => void
}

const STATUS_OPTIONS: { value: CheckStatus; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'overdue', label: 'Overdue' },
]

/** Check detail header: status, metadata grid, action buttons, paste-WO modal. */
export function CheckHeader({
  check,
  completedCount,
  totalCount,
  requiredIncomplete,
  error,
  loading,
  canAct,
  isAdmin,
  onStart,
  onComplete,
  onDelete,
  onPasteWOs,
  onForceStatus,
}: CheckHeaderProps) {
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [showReportDialog, setShowReportDialog] = useState(false)

  async function handleDownloadReport(complexity: ReportComplexity) {
    const res = await fetch(`/api/pm-report?check_id=${check.id}&complexity=${complexity}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }))
      alert(err.error ?? 'Report generation failed')
      throw new Error(err.error)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const disposition = res.headers.get('Content-Disposition')
    const match = disposition?.match(/filename="(.+?)"/)
    a.download = match?.[1] ?? 'PM Check Report.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    analyticsEvents.reportGenerated({
      report_type: `pm_check_${complexity}`,
      asset_count: totalCount,
    })
  }

  async function handleApplyPaste() {
    await onPasteWOs(pasteText)
    setShowPasteModal(false)
    setPasteText('')
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <StatusBadge status={statusToBadge(check.status)} />
        <span className="text-xs text-eq-grey">
          {completedCount}/{totalCount} tasks done
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="text-xs font-bold text-eq-grey uppercase">Site</dt>
          <dd className="text-eq-ink mt-1">{check.sites?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-eq-grey uppercase">Due Date</dt>
          <dd className="text-eq-ink mt-1">{formatDate(check.due_date)}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-eq-grey uppercase">Assigned To</dt>
          <dd className="text-eq-ink mt-1">{check.assignee_name ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold text-eq-grey uppercase">Frequency</dt>
          <dd className="text-eq-ink mt-1">
            {check.frequency
              ? check.frequency.replace('_', '-').replace(/\b\w/g, (c) => c.toUpperCase())
              : '—'}
          </dd>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {(check.status === 'scheduled' || check.status === 'overdue') && canAct && (
          <Button size="sm" onClick={onStart} disabled={loading}>
            Start Check
          </Button>
        )}
        {check.status === 'in_progress' && canAct && (
          <Button
            size="sm"
            onClick={onComplete}
            disabled={loading || requiredIncomplete > 0}
            title={requiredIncomplete > 0 ? `${requiredIncomplete} required tasks incomplete` : ''}
          >
            Complete Check
          </Button>
        )}
        {check.status === 'complete' && (
          <button
            onClick={() => setShowReportDialog(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-sky text-white rounded hover:bg-eq-deep transition-colors"
          >
            <Download className="w-4 h-4" /> Download Report
          </button>
        )}
        {canAct && (
          <Button size="sm" variant="secondary" onClick={() => setShowPasteModal(true)}>
            <ClipboardPaste className="w-4 h-4 mr-1" /> Paste WO #s
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" variant="danger" onClick={onDelete} disabled={loading}>
            Delete
          </Button>
        )}
      </div>

      {/* Admin status override — bypasses the scheduled → in_progress → complete
          guard rails so mistakes can be corrected (e.g. started by accident,
          need to reopen a completed check). */}
      {isAdmin && onForceStatus && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <label htmlFor="status-override" className="text-xs font-bold text-eq-grey uppercase">
            Admin: force status
          </label>
          <select
            id="status-override"
            value={check.status}
            onChange={(e) => onForceStatus(e.target.value as CheckStatus)}
            disabled={loading}
            className="h-8 px-2 text-xs border border-gray-200 rounded text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-1 focus:ring-eq-sky/20"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Paste WO Modal */}
      {showPasteModal && (
        <div className="border border-eq-sky/30 rounded-lg bg-eq-ice/30 p-4 space-y-3">
          <h4 className="text-xs font-bold text-eq-grey uppercase">Paste Work Order Numbers</h4>
          <p className="text-xs text-eq-grey">
            Paste a column from Excel — one WO per line. Numbers will be matched to assets in the current
            sort order.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder="Paste here..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleApplyPaste} disabled={loading || !pasteText.trim()}>
              Apply ({pasteText.split('\n').filter((l) => l.trim()).length} WOs)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowPasteModal(false)
                setPasteText('')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ReportDownloadDialog
        open={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        onDownload={handleDownloadReport}
        title="Maintenance Report"
      />
    </>
  )
}
