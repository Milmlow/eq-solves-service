'use client'

import { useState, useCallback } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { AttachmentList } from '@/components/ui/AttachmentList'
import { CheckHeader } from './CheckHeader'
import { CheckAssetTable, type SortKey, type SortDir } from './CheckAssetTable'
import type { CheckAssetWithDetails } from './AssetRow'
import {
  startCheckAction,
  completeCheckAction,
  cancelCheckAction,
  archiveCheckAction,
  updateCheckAction,
  updateCheckItemAction,
  forceCompleteCheckAssetAction,
  bulkUpdateWorkOrdersAction,
  updateCheckAssetAction,
} from './actions'
import type { CheckStatus } from '@/lib/types'
import type {
  MaintenanceCheck,
  MaintenanceCheckItem,
  CheckItemResult,
  Attachment,
} from '@/lib/types'

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

/**
 * Slide-panel container for a single maintenance check.
 * Orchestrates state + server actions; delegates rendering to
 * CheckHeader, CheckAssetTable, AssetRow, TaskRow.
 */
export function CheckDetail({
  open,
  onClose,
  check,
  items,
  checkAssets,
  attachments,
  isAdmin,
  canWrite: canWriteRole,
  isAssigned,
}: CheckDetailProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('maximo_id')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const canAct = canWriteRole || isAssigned

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // ─── Check-level actions ─────────────────────────────────────────────

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

  // Admin override — flip check status to any state without going through
  // the scheduled → in_progress → complete guard rails. Useful when a check
  // is started by mistake, needs to be reopened, or the workflow gates
  // otherwise block a legitimate correction. updateCheckAction accepts a
  // raw `status` field on the FormData (maintenance/actions.ts line 337).
  async function handleForceStatus(newStatus: CheckStatus) {
    if (!isAdmin) return
    if (newStatus === check.status) return
    if (
      !confirm(
        `Override check status to "${newStatus.replace('_', ' ')}"? This bypasses the normal workflow — only use it to correct mistakes.`
      )
    ) return
    setError(null)
    setLoading(true)
    const fd = new FormData()
    fd.set('status', newStatus)
    const result = await updateCheckAction(check.id, fd)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to update status.')
  }

  async function handleArchive() {
    if (
      !confirm(
        'Archive this entire maintenance check? It will be hidden from all list views. You can restore it later from the audit log.'
      )
    )
      return
    setError(null)
    setLoading(true)
    const result = await archiveCheckAction(check.id, false)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to archive.')
    else onClose()
  }

  // ─── Asset-level actions ─────────────────────────────────────────────

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
    const item = items.find((i) => i.id === itemId)
    formData.set('result', item?.result ?? '')
    formData.set('notes', notes)
    await updateCheckItemAction(check.id, itemId, formData)
  }

  const handleAssetNote = useCallback(
    async (checkAssetId: string, notes: string) => {
      await updateCheckAssetAction(check.id, checkAssetId, { notes })
    },
    [check.id]
  )

  const handleAssetWO = useCallback(
    async (checkAssetId: string, wo: string) => {
      await updateCheckAssetAction(check.id, checkAssetId, { work_order_number: wo })
    },
    [check.id]
  )

  // ─── Paste WO numbers from Excel ─────────────────────────────────────
  // Rebuilds the current sorted order then maps pasted lines in order.

  async function handlePasteWOs(rawText: string) {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return

    // Replicate the table's current sort order so pasted values line up
    // with what the user is seeing on screen.
    const sorted = [...checkAssets].sort((a, b) => {
      let aVal = ''
      let bVal = ''
      switch (sortKey) {
        case 'maximo_id':
          aVal = a.assets?.maximo_id ?? ''
          bVal = b.assets?.maximo_id ?? ''
          break
        case 'name':
          aVal = a.assets?.name ?? ''
          bVal = b.assets?.name ?? ''
          break
        case 'location':
          aVal = a.assets?.location ?? ''
          bVal = b.assets?.location ?? ''
          break
        case 'work_order':
          aVal = a.work_order_number ?? ''
          bVal = b.work_order_number ?? ''
          break
        case 'job_plan':
          aVal = (a.assets?.job_plans as { name: string } | null)?.name ?? ''
          bVal = (b.assets?.job_plans as { name: string } | null)?.name ?? ''
          break
        case 'completed': {
          const aDone = items.filter((i) => i.check_asset_id === a.id && i.result !== null).length
          const bDone = items.filter((i) => i.check_asset_id === b.id && i.result !== null).length
          return sortDir === 'asc' ? aDone - bDone : bDone - aDone
        }
        case 'notes':
          aVal = a.notes ?? ''
          bVal = b.notes ?? ''
          break
      }
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })

    const updates: { checkAssetId: string; workOrderNumber: string }[] = []
    for (let i = 0; i < Math.min(lines.length, sorted.length); i++) {
      updates.push({ checkAssetId: sorted[i].id, workOrderNumber: lines[i] })
    }

    setLoading(true)
    const result = await bulkUpdateWorkOrdersAction(check.id, updates)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to paste WO numbers.')
  }

  // ─── Derived counts ──────────────────────────────────────────────────

  const completedCount = items.filter((i) => i.result !== null).length
  const totalCount = items.length
  const requiredIncomplete = items.filter((i) => i.is_required && i.result === null).length

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title={check.custom_name ?? check.job_plans?.name ?? 'Maintenance Check'}
      wide
    >
      <div className="space-y-4">
        <CheckHeader
          check={check}
          completedCount={completedCount}
          totalCount={totalCount}
          requiredIncomplete={requiredIncomplete}
          error={error}
          loading={loading}
          canAct={canAct}
          isAdmin={isAdmin}
          onStart={handleStart}
          onComplete={handleComplete}
          onCancel={handleCancel}
          onArchive={handleArchive}
          onPasteWOs={handlePasteWOs}
          onForceStatus={handleForceStatus}
        />

        <CheckAssetTable
          checkAssets={checkAssets}
          items={items}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          expandedAssetId={expandedAssetId}
          onExpandAsset={setExpandedAssetId}
          canAct={canAct}
          checkStatus={check.status}
          onForceComplete={handleForceComplete}
          onItemResult={handleItemResult}
          onItemNotes={handleItemNotes}
          onAssetNote={handleAssetNote}
          onAssetWO={handleAssetWO}
        />

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
