'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  startCheckAction,
  completeCheckAction,
  cancelCheckAction,
  updateCheckItemAction,
} from './actions'
import { formatDate, formatCheckStatus } from '@/lib/utils/format'
import { AttachmentList } from '@/components/ui/AttachmentList'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckAsset, CheckStatus, CheckItemResult, Attachment } from '@/lib/types'
import { CheckCircle, XCircle, MinusCircle, Download } from 'lucide-react'

interface CheckAssetWithDetails extends CheckAsset {
  assets?: { name: string; maximo_id: string | null; location: string | null; job_plans?: { name: string } | null } | null
}

interface CheckDetailProps {
  open: boolean
  onClose: () => void
  check: MaintenanceCheck & {
    job_plans?: { name: string } | null
    sites?: { name: string } | null
    assignee_name?: string | null
  }
  items: MaintenanceCheckItem[]
  checkAssets: CheckAssetWithDetails[]
  attachments: Attachment[]
  isAdmin: boolean
  canWrite: boolean
  isAssigned: boolean
}

function statusToBadge(status: CheckStatus) {
  const map: Record<CheckStatus, 'not-started' | 'in-progress' | 'complete' | 'blocked' | 'overdue'> = {
    scheduled: 'not-started',
    in_progress: 'in-progress',
    complete: 'complete',
    cancelled: 'blocked',
    overdue: 'overdue',
  }
  return map[status]
}

export function CheckDetail({ open, onClose, check, items, checkAssets, attachments, isAdmin, canWrite: canWriteRole, isAssigned }: CheckDetailProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const canAct = canWriteRole || isAssigned

  async function handleStart() {
    setError(null)
    setLoading(true)
    const result = await startCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to start.')
  }

  async function handleComplete() {
    setError(null)
    setLoading(true)
    const result = await completeCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to complete.')
  }

  async function handleCancel() {
    setError(null)
    setLoading(true)
    const result = await cancelCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to cancel.')
    else onClose()
  }

  async function handleItemResult(itemId: string, result: CheckItemResult | null) {
    const formData = new FormData()
    formData.set('result', result ?? '')
    await updateCheckItemAction(check.id, itemId, formData)
  }

  async function handleItemNotes(itemId: string, notes: string) {
    const formData = new FormData()
    // Preserve existing result
    const item = items.find((i) => i.id === itemId)
    formData.set('result', item?.result ?? '')
    formData.set('notes', notes)
    await updateCheckItemAction(check.id, itemId, formData)
  }

  const completedCount = items.filter((i) => i.result !== null).length
  const totalCount = items.length
  const requiredIncomplete = items.filter((i) => i.is_required && i.result === null).length

  return (
    <SlidePanel open={open} onClose={onClose} title={check.custom_name ?? check.job_plans?.name ?? 'Maintenance Check'}>
      <div className="space-y-4">
        {/* Header info */}
        <div className="flex items-center justify-between">
          <StatusBadge status={statusToBadge(check.status)} />
          <span className="text-xs text-eq-grey">{completedCount}/{totalCount} tasks done</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
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
              {check.frequency ? check.frequency.replace('_', '-').replace(/\b\w/g, (c) => c.toUpperCase()) : '—'}
            </dd>
          </div>
          {check.maximo_wo_number && (
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Maximo WO #</dt>
              <dd className="text-eq-ink mt-1">{check.maximo_wo_number}</dd>
            </div>
          )}
          {check.maximo_pm_number && (
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Maximo PM #</dt>
              <dd className="text-eq-ink mt-1">{check.maximo_pm_number}</dd>
            </div>
          )}
        </div>

        {check.notes && (
          <div className="text-sm text-eq-grey bg-gray-50 rounded-md p-3">{check.notes}</div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {(check.status === 'scheduled' || check.status === 'overdue') && canAct && (
            <Button size="sm" onClick={handleStart} disabled={loading}>
              Start Check
            </Button>
          )}
          {check.status === 'in_progress' && canAct && (
            <Button
              size="sm"
              onClick={handleComplete}
              disabled={loading || requiredIncomplete > 0}
              title={requiredIncomplete > 0 ? `${requiredIncomplete} required tasks incomplete` : ''}
            >
              Complete Check
            </Button>
          )}
          {check.status === 'complete' && (
            <a
              href={`/api/pm-report?check_id=${check.id}`}
              download
              className="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-sky text-white rounded hover:bg-eq-deep transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Report
            </a>
          )}
          {check.status !== 'complete' && check.status !== 'cancelled' && isAdmin && (
            <Button size="sm" variant="danger" onClick={handleCancel} disabled={loading}>
              Cancel Check
            </Button>
          )}
        </div>

        {/* Maintenance Check Assets — matching Power Apps layout */}
        {checkAssets.length > 0 && (
          <div className="pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">
                Maintenance Check Assets ({checkAssets.length})
              </h3>
              <span className="text-xs text-eq-grey">
                {checkAssets.filter((ca) => ca.status === 'completed').length}/{checkAssets.length} completed
              </span>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[80px_1fr_1fr_100px_80px_60px] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-bold text-eq-grey uppercase">
                <span>ID</span>
                <span>Name</span>
                <span>Location</span>
                <span>Job Plan</span>
                <span>Done</span>
                <span>Notes</span>
              </div>
              {/* Asset rows */}
              <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                {checkAssets.map((ca) => {
                  const asset = ca.assets
                  const assetItems = items.filter((i) => i.check_asset_id === ca.id)
                  const assetDone = assetItems.filter((i) => i.result !== null).length
                  const assetTotal = assetItems.length
                  return (
                    <div key={ca.id} className="grid grid-cols-[80px_1fr_1fr_100px_80px_60px] gap-2 px-3 py-2 text-xs items-center hover:bg-gray-50">
                      <span className="font-mono text-eq-ink">{asset?.maximo_id ?? '—'}</span>
                      <span className="text-eq-ink truncate">{asset?.name ?? '—'}</span>
                      <span className="text-eq-grey truncate">{asset?.location ?? '—'}</span>
                      <span className="text-eq-grey">{(asset?.job_plans as { name: string } | null)?.name ?? '—'}</span>
                      <span className={assetDone === assetTotal && assetTotal > 0 ? 'text-green-600 font-medium' : 'text-eq-grey'}>
                        {assetDone}/{assetTotal}
                      </span>
                      <span className="text-eq-grey truncate">{ca.notes ?? '—'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Check items / tasks (grouped by asset) */}
        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-3">Outstanding Tasks</h3>
          <div className="space-y-2">
            {items.filter((i) => i.result === null).map((item) => (
              <CheckItemRow
                key={item.id}
                item={item}
                checkStatus={check.status}
                canAct={canAct}
                onResult={handleItemResult}
                onNotes={handleItemNotes}
              />
            ))}
            {items.filter((i) => i.result === null).length === 0 && (
              <p className="text-sm text-eq-grey">All tasks complete.</p>
            )}
          </div>
        </div>

        {/* Completed tasks (collapsed) */}
        {items.filter((i) => i.result !== null).length > 0 && (
          <details className="pt-2">
            <summary className="text-xs font-bold text-eq-grey uppercase tracking-wide cursor-pointer hover:text-eq-ink">
              Completed Tasks ({items.filter((i) => i.result !== null).length})
            </summary>
            <div className="space-y-2 mt-3">
              {items.filter((i) => i.result !== null).map((item) => (
                <CheckItemRow
                  key={item.id}
                  item={item}
                  checkStatus={check.status}
                  canAct={canAct}
                  onResult={handleItemResult}
                  onNotes={handleItemNotes}
                />
              ))}
            </div>
          </details>
        )}

        {/* Attachments */}
        <AttachmentList
          entityType="maintenance_check"
          entityId={check.id}
          attachments={attachments}
          canWrite={canWriteRole || isAssigned}
          isAdmin={isAdmin}
        />
      </div>
    </SlidePanel>
  )
}

function CheckItemRow({
  item,
  checkStatus,
  canAct,
  onResult,
  onNotes,
}: {
  item: MaintenanceCheckItem
  checkStatus: CheckStatus
  canAct: boolean
  onResult: (itemId: string, result: CheckItemResult | null) => void
  onNotes: (itemId: string, notes: string) => void
}) {
  const [showNotes, setShowNotes] = useState(false)
  const isActive = checkStatus === 'in_progress' && canAct

  const resultColors: Record<string, string> = {
    pass: 'text-green-600',
    fail: 'text-red-600',
    na: 'text-gray-400',
  }

  return (
    <div className="p-3 border border-gray-200 rounded-md">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm text-eq-ink">
            {item.description}
            {item.is_required && <span className="text-eq-sky text-xs font-medium ml-2">Required</span>}
          </p>
        </div>
        {isActive ? (
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => onResult(item.id, item.result === 'pass' ? null : 'pass')}
              className={`p-1.5 rounded transition-colors ${item.result === 'pass' ? 'bg-green-50 text-green-600' : 'text-gray-300 hover:text-green-500'}`}
              title="Pass"
            >
              <CheckCircle className="w-5 h-5" />
            </button>
            <button
              onClick={() => onResult(item.id, item.result === 'fail' ? null : 'fail')}
              className={`p-1.5 rounded transition-colors ${item.result === 'fail' ? 'bg-red-50 text-red-600' : 'text-gray-300 hover:text-red-500'}`}
              title="Fail"
            >
              <XCircle className="w-5 h-5" />
            </button>
            <button
              onClick={() => onResult(item.id, item.result === 'na' ? null : 'na')}
              className={`p-1.5 rounded transition-colors ${item.result === 'na' ? 'bg-gray-100 text-gray-600' : 'text-gray-300 hover:text-gray-500'}`}
              title="N/A"
            >
              <MinusCircle className="w-5 h-5" />
            </button>
          </div>
        ) : item.result ? (
          <span className={`text-xs font-semibold uppercase ${resultColors[item.result]}`}>
            {item.result === 'na' ? 'N/A' : item.result}
          </span>
        ) : (
          <span className="text-xs text-gray-300">Pending</span>
        )}
      </div>

      {/* Notes toggle */}
      {isActive && (
        <div className="mt-2">
          {!showNotes ? (
            <button
              onClick={() => setShowNotes(true)}
              className="text-xs text-eq-sky hover:text-eq-deep transition-colors"
            >
              {item.notes ? 'Edit notes' : 'Add notes'}
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                defaultValue={item.notes ?? ''}
                placeholder="Notes..."
                onBlur={(e) => { onNotes(item.id, e.target.value); setShowNotes(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { onNotes(item.id, (e.target as HTMLInputElement).value); setShowNotes(false) } }}
                className="flex-1 h-8 px-3 border border-gray-200 rounded text-xs text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {!isActive && item.notes && (
        <p className="text-xs text-eq-grey mt-1">{item.notes}</p>
      )}
    </div>
  )
}
