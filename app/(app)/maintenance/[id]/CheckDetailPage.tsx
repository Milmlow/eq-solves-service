'use client'

import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  startCheckAction,
  completeCheckAction,
  cancelCheckAction,
  updateCheckItemAction,
  forceCompleteCheckAssetAction,
  bulkUpdateWorkOrdersAction,
  updateCheckAssetAction,
  completeAllCheckAssetsAction,
} from '../actions'
import { formatDate } from '@/lib/utils/format'
import { AttachmentList } from '@/components/ui/AttachmentList'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckAsset, CheckStatus, CheckItemResult, Attachment } from '@/lib/types'
import { CheckCircle, XCircle, MinusCircle, Download, ChevronDown, ChevronRight, ClipboardPaste, CheckCheck, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface CheckAssetWithDetails extends CheckAsset {
  assets?: { name: string; maximo_id: string | null; location: string | null; job_plans?: { name: string } | null } | null
}

interface CheckDetailPageProps {
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

export function CheckDetailPage({ check, items, checkAssets, attachments, isAdmin, canWrite: canWriteRole, isAssigned }: CheckDetailPageProps) {
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
  }

  async function handleForceComplete(checkAssetId: string) {
    setError(null)
    const result = await forceCompleteCheckAssetAction(check.id, checkAssetId)
    if (!result.success) setError(result.error ?? 'Failed to force complete.')
  }

  async function handleCompleteAll() {
    if (!confirm('Mark ALL assets and their tasks as complete? This cannot be undone.')) return
    setError(null); setLoading(true)
    const result = await completeAllCheckAssetsAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to complete all assets.')
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
  const completedAssets = checkAssets.filter(ca => ca.status === 'completed').length
  const requiredIncomplete = items.filter(i => i.is_required && i.result === null).length

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-start justify-between gap-4 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <StatusBadge status={statusToBadge(check.status)} />
            <span className="text-sm text-eq-grey">{completedCount}/{totalCount} tasks done</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
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
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap shrink-0">
          {(check.status === 'scheduled' || check.status === 'overdue') && canAct && (
            <Button size="sm" onClick={handleStart} disabled={loading}>Start Check</Button>
          )}
          {check.status === 'in_progress' && canAct && (
            <>
              <Button size="sm" onClick={handleCompleteAll} disabled={loading}>
                <CheckCheck className="w-4 h-4 mr-1" /> Complete All Assets
              </Button>
              <Button size="sm" onClick={handleComplete} disabled={loading || requiredIncomplete > 0}
                title={requiredIncomplete > 0 ? `${requiredIncomplete} required tasks incomplete` : ''}>
                Complete Check
              </Button>
            </>
          )}
          {check.status === 'complete' && (
            <a href={`/api/pm-asset-report?check_id=${check.id}`} download
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-sky text-white rounded hover:bg-eq-deep transition-colors">
              <Download className="w-4 h-4" /> Download Report
            </a>
          )}
          {check.status !== 'complete' && check.status !== 'cancelled' && isAdmin && (
            <Button size="sm" variant="danger" onClick={handleCancel} disabled={loading}>Cancel</Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-2 rounded-lg">{error}</p>}

      {/* Paste WO modal */}
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

      {/* Asset Table — full width */}
      {checkAssets.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <span className="text-sm font-bold text-eq-ink">
              Maintenance Check Assets ({checkAssets.length})
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm text-eq-grey">
                {completedAssets}/{checkAssets.length} completed
              </span>
              {canAct && (
                <Button size="sm" variant="secondary" onClick={() => setShowPasteModal(true)}>
                  <ClipboardPaste className="w-4 h-4 mr-1" /> Paste WO #s
                </Button>
              )}
            </div>
          </div>

          {/* Full-width table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {([
                    ['maximo_id', 'ID', 'w-24'],
                    ['name', 'Name', ''],
                    ['location', 'Location', ''],
                    ['work_order', 'Work Order #', 'w-36'],
                    ['job_plan', 'Job Plan', 'w-32'],
                    ['completed', 'Done', 'w-24'],
                    ['notes', 'Notes', 'w-40'],
                  ] as [SortKey, string, string][]).map(([key, label, width]) => (
                    <th key={key}
                      onClick={() => toggleSort(key)}
                      className={`px-4 py-2.5 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer hover:text-eq-ink transition-colors select-none ${width}`}
                    >
                      {label}{sortIndicator(key)}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
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
              </tbody>
            </table>
          </div>
        </div>
      )}

      {checkAssets.length === 0 && (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm">No assets linked to this maintenance check.</p>
        </div>
      )}

      {/* Attachments */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <AttachmentList
          entityType="maintenance_check"
          entityId={check.id}
          attachments={attachments}
          canWrite={canWriteRole || isAssigned}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}

/* ──────── Asset Row ──────── */

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
    <>
      {/* Main row */}
      <tr
        className={`cursor-pointer transition-colors ${
          isExpanded ? 'bg-eq-ice/40' : 'hover:bg-gray-50'
        } ${allDone ? 'opacity-60' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-2.5 font-mono text-eq-ink whitespace-nowrap">
          <span className="flex items-center gap-1">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-eq-grey shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-eq-grey shrink-0" />}
            {asset?.maximo_id ?? '—'}
          </span>
        </td>
        <td className="px-4 py-2.5 text-eq-ink">{asset?.name ?? '—'}</td>
        <td className="px-4 py-2.5 text-eq-grey">{asset?.location ?? '—'}</td>

        {/* WO # — editable */}
        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
          {editingWO ? (
            <input
              defaultValue={ca.work_order_number ?? ''}
              onBlur={e => { onAssetWO(e.target.value); setEditingWO(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { onAssetWO((e.target as HTMLInputElement).value); setEditingWO(false) } }}
              className="w-full h-7 px-2 border border-eq-sky rounded text-sm font-mono bg-white focus:outline-none"
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
        </td>

        <td className="px-4 py-2.5 text-eq-grey">{jpName}</td>

        {/* Completed indicator */}
        <td className="px-4 py-2.5">
          <span className={allDone ? 'text-green-600 font-medium' : 'text-eq-grey'}>
            {allDone ? 'Yes' : `${doneCount}/${total}`}
          </span>
        </td>

        {/* Notes — editable */}
        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
          {editingNotes ? (
            <input
              defaultValue={ca.notes ?? ''}
              onBlur={e => { onAssetNote(e.target.value); setEditingNotes(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { onAssetNote((e.target as HTMLInputElement).value); setEditingNotes(false) } }}
              className="w-full h-7 px-2 border border-eq-sky rounded text-sm bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text truncate block max-w-[10rem] ${ca.notes ? 'text-eq-ink' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingNotes(true)}
            >
              {ca.notes || '---'}
            </span>
          )}
        </td>

        <td className="px-2 py-2.5">
          {canAct && !allDone && items.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); onForceComplete() }}
              className="p-1.5 rounded text-green-600 hover:bg-green-50 transition-colors"
              title="Force complete all tasks"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
          )}
        </td>
      </tr>

      {/* Expanded: Outstanding tasks for this asset */}
      {isExpanded && (
        <tr>
          <td colSpan={8} className="bg-gray-50 px-0 py-0">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-eq-ink">
                  Outstanding Tasks — {jpName} ({items.length} tasks, {doneCount} completed)
                </h4>
                {canAct && !allDone && (
                  <button
                    onClick={onForceComplete}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200 transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Force Complete All
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <p className="text-sm text-eq-grey">No tasks for this asset.</p>
              ) : (
                <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
                  <thead>
                    <tr className="bg-white border-b border-gray-200">
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase w-12">Order</th>
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase">Task</th>
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase w-28">Result</th>
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase">Comments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
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
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ──────── Task Row ──────── */

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
    <tr className={`${item.result ? 'opacity-60' : ''}`}>
      <td className="px-4 py-2 text-eq-grey font-mono text-xs">{item.sort_order}</td>
      <td className="px-4 py-2 text-eq-ink">
        {item.description}
        {item.is_required && <span className="text-eq-sky font-medium ml-1">*</span>}
      </td>

      {/* Result buttons */}
      <td className="px-4 py-2">
        {isActive ? (
          <div className="flex items-center gap-1">
            <button onClick={() => onResult(item.id, item.result === 'pass' ? null : 'pass')}
              className={`p-1.5 rounded transition-colors ${item.result === 'pass' ? 'bg-green-50 text-green-600' : 'text-gray-300 hover:text-green-500'}`} title="Pass">
              <CheckCircle className="w-4 h-4" />
            </button>
            <button onClick={() => onResult(item.id, item.result === 'fail' ? null : 'fail')}
              className={`p-1.5 rounded transition-colors ${item.result === 'fail' ? 'bg-red-50 text-red-600' : 'text-gray-300 hover:text-red-500'}`} title="Fail">
              <XCircle className="w-4 h-4" />
            </button>
            <button onClick={() => onResult(item.id, item.result === 'na' ? null : 'na')}
              className={`p-1.5 rounded transition-colors ${item.result === 'na' ? 'bg-gray-100 text-gray-600' : 'text-gray-300 hover:text-gray-500'}`} title="N/A">
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
      </td>

      {/* Comments — inline editable */}
      <td className="px-4 py-2">
        {editingNotes ? (
          <input
            defaultValue={item.notes ?? ''}
            onBlur={e => { onNotes(item.id, e.target.value); setEditingNotes(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onNotes(item.id, (e.target as HTMLInputElement).value); setEditingNotes(false) } }}
            className="w-full h-7 px-2 border border-eq-sky rounded text-sm bg-white focus:outline-none"
            autoFocus
          />
        ) : (
          <span
            className={`cursor-text ${item.notes ? 'text-eq-ink' : 'text-gray-300'}`}
            onClick={() => isActive && setEditingNotes(true)}
          >
            {item.notes || '---'}
          </span>
        )}
      </td>
    </tr>
  )
}
