'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, MinusCircle } from 'lucide-react'
import type { MaintenanceCheckItem, CheckStatus, CheckItemResult } from '@/lib/types'

interface TaskRowProps {
  item: MaintenanceCheckItem
  checkStatus: CheckStatus
  canAct: boolean
  onResult: (itemId: string, result: CheckItemResult | null) => void
  onNotes: (itemId: string, notes: string) => void
}

/**
 * Single pass/fail/NA row with inline-editable comments.
 *
 * Result buttons use optimistic local state so the pressed colour lands the
 * instant the tech taps — previously the UI waited for the server action
 * (and its path revalidation) before showing feedback, which Simon flagged
 * as "takes a very long time to show as pressed" on tablet.
 */
export function TaskRow({ item, checkStatus, canAct, onResult, onNotes }: TaskRowProps) {
  const [editingNotes, setEditingNotes] = useState(false)
  const [localResult, setLocalResult] = useState<CheckItemResult | null>(item.result)
  const isActive = checkStatus === 'in_progress' && canAct

  // Keep local state in sync when the server truth changes (e.g. another
  // user updated the row, or our own save returned with a different value).
  useEffect(() => {
    setLocalResult(item.result)
  }, [item.result])

  function handlePress(next: CheckItemResult | null) {
    setLocalResult(next)
    onResult(item.id, next)
  }

  const resultColors: Record<string, string> = {
    pass: 'text-green-600',
    fail: 'text-red-600',
    na: 'text-gray-400',
  }

  // Shared button classes — 44px minimum tap target for techs in gloves on
  // tablets/phones. touch-manipulation kills the iOS tap delay and active:scale
  // gives an immediate tactile cue on tap.
  const btnBase = 'min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded select-none touch-manipulation active:scale-90'

  return (
    <div className="grid grid-cols-[1fr_152px_1fr] gap-2 px-3 py-2 text-xs items-center">
      {/* Task description */}
      <span className="text-eq-ink">
        {item.description}
        {item.is_required && <span className="text-eq-sky font-medium ml-1">*</span>}
      </span>

      {/* Result buttons */}
      {isActive ? (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => handlePress(localResult === 'pass' ? null : 'pass')}
            className={`${btnBase} ${
              localResult === 'pass' ? 'bg-green-50 text-green-600' : 'text-gray-300 hover:text-green-500'
            }`}
            title="Pass"
            aria-label="Pass"
          >
            <CheckCircle className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => handlePress(localResult === 'fail' ? null : 'fail')}
            className={`${btnBase} ${
              localResult === 'fail' ? 'bg-red-50 text-red-600' : 'text-gray-300 hover:text-red-500'
            }`}
            title="Fail"
            aria-label="Fail"
          >
            <XCircle className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => handlePress(localResult === 'na' ? null : 'na')}
            className={`${btnBase} ${
              localResult === 'na' ? 'bg-gray-100 text-gray-600' : 'text-gray-300 hover:text-gray-500'
            }`}
            title="N/A"
            aria-label="N/A"
          >
            <MinusCircle className="w-5 h-5" />
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
          onBlur={(e) => {
            onNotes(item.id, e.target.value)
            setEditingNotes(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onNotes(item.id, (e.target as HTMLInputElement).value)
              setEditingNotes(false)
            }
          }}
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
