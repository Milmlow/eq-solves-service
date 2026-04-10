'use client'

import { useState, useMemo, useCallback } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  startCheckAction,
  completeCheckAction,
  cancelCheckAction,
  archiveCheckAction,
  updateCheckItemAction,
  forceCompleteCheckAssetAction,
  bulkUpdateWorkOrdersAction,
  updateCheckAssetAction,
} from './actions'
import { formatDate, formatCheckStatus } from '@/lib/utils/format'
import { AttachmentList } from '@/components/ui/AttachmentList'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckAsset, CheckStatus, CheckItemResult, Attachment } from '@/lib/types'
import { CheckCircle, XCircle, MinusCircle, Download, ChevronDown, ChevronRight, ClipboardPaste, CheckCheck } from 'lucide-react'

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

type SortKey = 'maximo_id' | 'name' | 'location' | 'work_order' | 'job_plan' | 'completed' | 'notes'
type SortDir = 'asc' | 'desc'

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
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('maximo_id')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const canAct = canWriteRole || isAssigned

  // Sort logic
  const sortedAssets = useMemo(() => {
    const arr = [...checkAssets]
    arr.sort((a, b) => {
      let aVal = ''
      let bVal = ''
      const aAsset = a.assets
      const bAsset = b.assets

      switch (sortKey) {
        case 'maximo_id': aVal = aAsset?.maximo_id ?? ''; bVal = bAsset?.maximo_id ?? ''; break
        case 'name': aVal = aAsset?.name ?? ''; bVal = bAsset?.name ?? ''; break
        case 'location': aVal = aAsset?.location ?? ''; bVal = bAsset?.location ?? ''; break
        case 'work_order': aVal = a.work_order_number ?? ''; bVal = b.work_order_number ?? ''; break
        case 'job_plan': aVal = (aAsset?.job_plans as { name: string } | null)?.name ?? ''; bVal = (bAsset?.job_plans as { name: string } | null)?.name ?? ''; break
        case 'completed': {
          const aDone = items.filter(i => i.check_asset_id === a.id && i.result !== null).length
          const bDone = items.filter(i => i.check_asset_id === b.id && i.result !== null).length
          return sortDir === 'asc' ? aDone - bDone : bDone - aDone
        }
        case 'notes': aVal = a.notes ?? ''; bVal = b.notes ?? ''; break
      }
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [checkAssets, items, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  // Actions
  async function handleStart() {
    setError(null); setLoading(true)
    const result = await startCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to start.')
  }

  async function handleComplete() {
    setError(null); setLoading(true)
    const result = await completeCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to complete.')
  }

  async function handleCancel() {
    setError(null); setLoading(true)
    const result = await cancelCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to cancel.')
    else onClose()
  }

  async function handleArchive() {
    if (!confirm('Archive this entire maintenance check? It will be hidden from all list views. You can restore it later from the audit log.')) return
    setError(null); setLoading(true)
    const result = await archiveCheckAction(check.id, false)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to archive.')
    else onClose()
  }

  async function handleForceComplete(checkAssetId: string) {
    setError(null)
    const result = await forceCompleteCheckAssetAction(check.id, checkAssetId)
    if (!result.success) setError(result.error ?? 'Failed to force complete.')
  }

  async function handleItemResult(itemId: string, result: CheckItemResult | null) {
    const formData = new FormData()
    formData.set('result', result ?? '')
    await updateCheckItemAction(check.id, itemId, formData)
  }

  async function handleItemNotes(itemId: string, notes: string) {
    const formData = new FormData()
    const item = items.find(i => i.id === itemId)
    formData.set('result', item?.result ?? '')
    formData.set('notes', notes)
    await updateCheckItemAction(check.id, itemId, formData)
  }

  const handleAssetNote = useCallback(async (checkAssetId: string, notes: string) => {
    await updateCheckAssetAction(check.id, checkAssetId, { notes })
  }, [check.id])

  const handleAssetWO = useCallback(async (checkAssetId: string, wo: string) => {
    await updateCheckAssetAction(check.id, checkAssetId, { work_order_number: wo })
  }, [check.id])

  // Paste WO numbers from Excel
  async function handlePasteWOs() {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    // Match WO numbers to assets in display order
    const updates: { checkAssetId: string; workOrderNumber: string }[] = []
    for (let i = 0; i < Math.min(lines.length, sortedAssets.length); i++) {
      updates.push({ checkAssetId: sortedAssets[i].id, workOrderNumber: lines[i] })
    }

    setLoading(true)
    const result = await bulkUpdateWorkOrdersAction(check.id, updates)
    setLoading(false)
    if (result.success) {
      setShowPasteModal(false)
      setPasteText('')
    } else {
      setError(result.error ?? 'Failed to paste WO numbers.')
    }
  }

  const completedCount = items.filter(i => i.result !== null).length
  const totalCount = items.length
  const requiredIncomplete = items.filter(i => i.is_required && i.result === null).length

  return (
    <SlidePanel open={open} onClose={onClose} title={check.custom_name ?? check.job_plans?.name ?? 'Maintenance Check'} wide>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <StatusBadge status={statusToBadge(check.status)} />
          <span className="text-xs text-eq-grey">{completedCount}/{totalCount} tasks done</span>
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
              {check.frequency ? check.frequency.replace('_', '-').replace(/\b\w/g, c => c.toUpperCase()) : '—'}
            </dd>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {(check.status === 'scheduled' || check.status === 'overdue') && canAct && (
            <Button size="sm" onClick={handleStart} disabled={loading}>Start Check</Button>
          )}
          {check.status === 'in_progress' && canAct && (
            <Button size="sm" onClick={handleComplete} disabled={loading || requiredIncomplete > 0}
              title={requiredIncomplete > 0 ? `${requiredIncomplete} required tasks incomplete` : ''}>
              Complete Check
            </Button>
          )}
          {check.status === 'complete' && (
            <a href={`/api/pm-report?check_id=${check.id}`} download
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-sky text-white rounded hover:bg-eq-deep transition-colors">
              <Download className="w-4 h-4" /> Download Report
            </a>
          )}
          {canAct && (
            <Button size="sm" variant="secondary" onClick={() => setShowPasteModal(true)}>
              <ClipboardPaste className="w-4 h-4 mr-1" /> Paste WO #s
            </Button>
          )}
          {check.status !== 'complete' && check.status !== 'cancelled' && isAdmin && (
            <Button size="sm" variant="danger" onClick={handleCancel} disabled={loading}>Cancel</Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="danger" onClick={handleArchive} disabled={loading}>Archive</Button>
          )}
        </div>

        {/* Paste WO Modal */}
        {showPasteModal && (
          <div className="border border-eq-sky/30 rounded-lg bg-eq-ice/30 p-4 space-y-3">
            <h4 className="text-xs font-bold text-eq-grey uppercase">Paste Work Order Numbers</h4>
            <p className="text-xs text-eq-grey">Paste a column from Excel — one WO per line. Numbers will be matched to assets in the current sort order.</p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={6}
              placeholder="Paste here..."
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handlePasteWOs} disabled={loading || !pasteText.trim()}>
                Apply ({pasteText.split('\n').filter(l => l.trim()).length} WOs)
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { setShowPasteModal(false); setPasteText('') }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Asset Table */}
        {checkAssets.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-bold text-eq-grey uppercase">
                Maintenance Check Assets ({checkAssets.length})
              </span>
              <span className="text-xs text-eq-grey">
                {checkAssets.filter(ca => ca.status === 'completed').length}/{checkAssets.length} completed
              </span>
            </div>

            {/* Sortable header */}
            <div className="grid grid-cols-[80px_1fr_1fr_100px_100px_70px_80px] gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200">
              {([
                ['maximo_id', 'ID'],
                ['name', 'Name'],
                ['location', 'Location'],
                ['work_order', 'WO #'],
                ['job_plan', 'Job Plan'],
                ['completed', 'Done'],
                ['notes', 'Notes'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <button key={key} onClick={() => toggleSort(key)}
                  className="text-xs font-bold text-eq-grey uppercase text-left hover:text-eq-ink transition-colors truncate">
                  {label}{sortIndicator(key)}
                </button>
              ))}
            </div>

            {/* Asset rows */}
            <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
              {sortedAssets.map(ca => (
                <AssetRow
                  key={ca.id}
                  ca={ca}
                  items={items.filter(i => i.check_asset_id === ca.id)}
                  isExpanded={expandedAssetId === ca.id}
                  onToggle={() => setExpandedAssetId(expandedAssetId === ca.id ? null : ca.id)}
                  canAct={canAct}
                  checkStatus={check.status}
                  onForceComplete={() => handleForceComplete(ca.id)}
                  onItemResult={handleItemResult}
                  onItemNotes={handleItemNotes}
                  onAssetNote={(notes) => handleAssetNote(ca.id, notes)}
                  onAssetWO={(wo) => handleAssetWO(ca.id, wo)}
                />
              ))}
            </div>
          </div>
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

/* ──────── Asset Row (clickable → expand tasks) ──────── */

function AssetRow({
  ca, items, isExpanded, onToggle, canAct, checkStatus, onForceComplete,
  onItemResult, onItemNotes, onAssetNote, onAssetWO,
}: {
  ca: CheckAssetWithDetails
  items: MaintenanceCheckItem[]
  isExpanded: boolean
  onToggle: () => void
  canAct: boolean
  checkStatus: CheckStatus
  onForceComplete: () => void
  onItemResult: (itemId: string, result: CheckItemResult | null) => void
  onItemNotes: (itemId: string, notes: string) => void
  onAssetNote: (notes: string) => void
  onAssetWO: (wo: string) => void
}) {
  const [editingWO, setEditingWO] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)

  const asset = ca.assets
  const doneCount = items.filter(i => i.result !== null).length
  const total = items.length
  const allDone = doneCount === total && total > 0
  const jpName = (asset?.job_plans as { name: string } | null)?.name ?? '—'

  return (
    <div>
      {/* Main row */}
      <div
        className={`grid grid-cols-[80px_1fr_1fr_100px_100px_70px_80px] gap-1 px-3 py-2 text-xs items-center cursor-pointer transition-colors ${
          isExpanded ? 'bg-eq-ice/40' : 'hover:bg-gray-50'
        } ${allDone ? 'opacity-60' : ''}`}
        onClick={onToggle}
      >
        <span className="font-mono text-eq-ink flex items-center gap-1">
          {isExpanded ? <ChevronDown className="w-3 h-3 text-eq-grey" /> : <ChevronRight className="w-3 h-3 text-eq-grey" />}
          {asset?.maximo_id ?? '—'}
        </span>
        <span className="text-eq-ink truncate">{asset?.name ?? '—'}</span>
        <span className="text-eq-grey truncate">{asset?.location ?? '—'}</span>

        {/* WO # — editable */}
        <span onClick={e => e.stopPropagation()}>
          {editingWO ? (
            <input
              defaultValue={ca.work_order_number ?? ''}
              onBlur={e => { onAssetWO(e.target.value); setEditingWO(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { onAssetWO((e.target as HTMLInputElement).value); setEditingWO(false) } }}
              className="w-full h-6 px-1 border border-eq-sky rounded text-xs font-mono bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text ${ca.work_order_number ? 'text-eq-ink font-mono' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingWO(true)}
            >
              {ca.work_order_number || '---'}
            </span>
          )}
        </span>

        <span className="text-eq-grey">{jpName}</span>

        {/* Completed indicator */}
        <span className={allDone ? 'text-green-600 font-medium' : 'text-eq-grey'}>
          {allDone ? 'Yes' : `${doneCount}/${total}`}
        </span>

        {/* Notes — editable */}
        <span onClick={e => e.stopPropagation()}>
          {editingNotes ? (
            <input
              defaultValue={ca.notes ?? ''}
              onBlur={e => { onAssetNote(e.target.value); setEditingNotes(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { onAssetNote((e.target as HTMLInputElement).value); setEditingNotes(false) } }}
              className="w-full h-6 px-1 border border-eq-sky rounded text-xs bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text truncate ${ca.notes ? 'text-eq-ink' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingNotes(true)}
            >
              {ca.notes || '---'}
            </span>
          )}
        </span>
      </div>

      {/* Expanded: job plan items table */}
      {isExpanded && (
        <div className="bg-white border-t border-gray-100 px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-eq-grey uppercase">
              Job Plan Items — {jpName} ({items.length} tasks)
            </h4>
            {canAct && !allDone && (
              <button
                onClick={onForceComplete}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 rounded hover:bg-green-100 transition-colors"
              >
                <CheckCheck className="w-3 h-3" /> Force Complete All
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-xs text-eq-grey">No tasks for this asset.</p>
          ) : (
            <div className="border border-gray-200 rounded overflow-hidden">
              {/* Task table header */}
              <div className="grid grid-cols-[1fr_80px_1fr] gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-bold text-eq-grey uppercase">
                <span>Task</span>
                <span>Result</span>
                <span>Comments</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                {items.map(item => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    checkStatus={checkStatus}
                    canAct={canAct}
                    onResult={onItemResult}
                    onNotes={onItemNotes}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ──────── Task Row (Pass/Fail/NA + comments) ──────── */

function TaskRow({
  item, checkStatus, canAct, onResult, onNotes,
}: {
  item: MaintenanceCheckItem
  checkStatus: CheckStatus
  canAct: boolean
  onResult: (itemId: string, result: CheckItemResult | null) => void
  onNotes: (itemId: string, notes: string) => void
}) {
  const [editingNotes, setEditingNotes] = useState(false)
  const isActive = checkStatus === 'in_progress' && canAct

  const resultColors: Record<string, string> = {
    pass: 'text-green-600',
    fail: 'text-red-600',
    na: 'text-gray-400',
  }

  return (
    <div className="grid grid-cols-[1fr_80px_1fr] gap-2 px-3 py-2 text-xs items-center">
      {/* Task description */}
      <span className="text-eq-ink">
        {item.description}
        {item.is_required && <span className="text-eq-sky font-medium ml-1">*</span>}
      </span>

      {/* Result buttons */}
      {isActive ? (
        <div className="flex items-center gap-0.5">
          <button onClick={() => onResult(item.id, item.result === 'pass' ? null : 'pass')}
            className={`p-1 rounded transition-colors ${item.result === 'pass' ? 'bg-green-50 text-green-600' : 'text-gray-300 hover:text-green-500'}`} title="Pass">
            <CheckCircle className="w-4 h-4" />
          </button>
          <button onClick={() => onResult(item.id, item.result === 'fail' ? null : 'fail')}
            className={`p-1 rounded transition-colors ${item.result === 'fail' ? 'bg-red-50 text-red-600' : 'text-gray-300 hover:text-red-500'}`} title="Fail">
            <XCircle className="w-4 h-4" />
          </button>
          <button onClick={() => onResult(item.id, item.result === 'na' ? null : 'na')}
            className={`p-1 rounded transition-colors ${item.result === 'na' ? 'bg-gray-100 text-gray-600' : 'text-gray-300 hover:text-gray-500'}`} title="N/A">
            <MinusCircle className="w-4 h-4" />
          </button>
        </div>
      ) : item.result ? (
        <span className={`font-semibold uppercase ${resultColors[item.result]}`}>
          {item.result === 'na' ? 'N/A' : item.result}
        </span>
      ) : (
        <span className="text-gray-300">—</span>
      )}

      {/* Comments — inline editable */}
      {editingNotes ? (
        <input
          defaultValue={item.notes ?? ''}
          onBlur={e => { onNotes(item.id, e.target.value); setEditingNotes(false) }}
          onKeyDown={e => { if (e.key === 'Enter') { onNotes(item.id, (e.target as HTMLInputElement).value); setEditingNotes(false) } }}
          className="h-6 px-1 border border-eq-sky rounded text-xs bg-white focus:outline-none"
          autoFocus
        />
      ) : (
        <span
          className={`cursor-text truncate ${item.notes ? 'text-eq-ink' : 'text-gray-300'}`}
          onClick={() => isActive && setEditingNotes(true)}
        >
          {item.notes || '---'}
        </span>
      )}
    </div>
  )
}
