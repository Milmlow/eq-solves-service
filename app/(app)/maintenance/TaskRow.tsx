'use client'

import { useState } from 'react'
import { CheckCircle, XCircle, MinusCircle } from 'lucide-react'
import type { MaintenanceCheckItem, CheckStatus, CheckItemResult } from '@/lib/types'

interface TaskRowProps {
  item: MaintenanceCheckItem
  checkStatus: CheckStatus
  canAct: boolean
  onResult: (itemId: string, result: CheckItemResult | null) => void
  onNotes: (itemId: string, notes: string) => void
}

/** Single pass/fail/NA row with inline-editable comments. */
export function TaskRow({ item, checkStatus, canAct, onResult, onNotes }: TaskRowProps) {
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
          <button
            onClick={() => onResult(item.id, item.result === 'pass' ? null : 'pass')}
            className={`p-1 rounded transition-colors ${
              item.result === 'pass' ? 'bg-green-50 text-green-600' : 'text-gray-300 hover:text-green-500'
            }`}
            title="Pass"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
          <button
            onClick={() => onResult(item.id, item.result === 'fail' ? null : 'fail')}
            className={`p-1 rounded transition-colors ${
              item.result === 'fail' ? 'bg-red-50 text-red-600' : 'text-gray-300 hover:text-red-500'
            }`}
            title="Fail"
          >
            <XCircle className="w-4 h-4" />
          </button>
          <button
            onClick={() => onResult(item.id, item.result === 'na' ? null : 'na')}
            className={`p-1 rounded transition-colors ${
              item.result === 'na' ? 'bg-gray-100 text-gray-600' : 'text-gray-300 hover:text-gray-500'
            }`}
            title="N/A"
          >
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
