'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateDefectAction } from '@/app/(app)/maintenance/actions'

/**
 * S-W2-1 — editable controls for the defect detail page. Mirrors the
 * inline editor in DefectRow but laid out for a full page. Writers can
 * edit any defect; technicians can edit defects assigned to them (the
 * server action enforces this — the form just surfaces the fields).
 */
interface DefectDetailFormProps {
  defectId: string
  initial: {
    status: string
    assigned_to: string | null
    work_order_number: string | null
    work_order_date: string | null
    resolution_notes: string | null
  }
  team: Array<{ id: string; name: string }>
  canEdit: boolean
}

export function DefectDetailForm({ defectId, initial, team, canEdit }: DefectDetailFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState(initial.status)
  const [assigned, setAssigned] = useState(initial.assigned_to ?? '')
  const [wo, setWo] = useState(initial.work_order_number ?? '')
  const [woDate, setWoDate] = useState(initial.work_order_date ?? '')
  const [notes, setNotes] = useState(initial.resolution_notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!canEdit) return null

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateDefectAction(defectId, {
        status,
        assigned_to: assigned || null,
        work_order_number: wo || null,
        work_order_date: woDate || null,
        resolution_notes: notes || undefined,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to update defect.')
      } else {
        setSaved(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3 bg-gray-50 rounded-xl p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Assigned to</label>
          <select
            value={assigned}
            onChange={(e) => setAssigned(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Work Order #</label>
          <input
            type="text"
            value={wo}
            onChange={(e) => setWo(e.target.value)}
            placeholder="e.g. WO-2024-0123"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Work Order Date</label>
          <input
            type="date"
            value={woDate}
            onChange={(e) => setWoDate(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Resolution notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Describe what was done to resolve this defect..."
          className="w-full min-h-[88px] text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white resize-y"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && !error && <p className="text-xs text-green-600">Saved.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="px-4 py-1.5 rounded-lg bg-eq-sky text-white text-sm font-medium hover:bg-eq-deep transition-colors disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
