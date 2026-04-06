'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import {
  createJobPlanAction,
  updateJobPlanAction,
  toggleJobPlanActiveAction,
  createJobPlanItemAction,
  updateJobPlanItemAction,
  deleteJobPlanItemAction,
} from './actions'
import type { JobPlan, JobPlanItem, Site } from '@/lib/types'
import { Plus, Trash2 } from 'lucide-react'

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual', label: 'Bi-annual' },
  { value: 'annual', label: 'Annual' },
  { value: 'ad_hoc', label: 'Ad Hoc' },
]

interface JobPlanFormProps {
  open: boolean
  onClose: () => void
  jobPlan?: JobPlan | null
  items?: JobPlanItem[]
  sites: Pick<Site, 'id' | 'name'>[]
  isAdmin: boolean
  canWrite: boolean
}

export function JobPlanForm({ open, onClose, jobPlan, items = [], sites, isAdmin, canWrite: canWriteRole }: JobPlanFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  const [showAddItem, setShowAddItem] = useState(false)

  const isEdit = !!jobPlan

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEdit
      ? await updateJobPlanAction(jobPlan!.id, formData)
      : await createJobPlanAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      if (!isEdit) setTimeout(() => onClose(), 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleToggleActive() {
    if (!jobPlan) return
    setLoading(true)
    const result = await toggleJobPlanActiveAction(jobPlan.id, !jobPlan.is_active)
    setLoading(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleAddItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!jobPlan) return
    setItemError(null)

    const formData = new FormData(e.currentTarget)
    const result = await createJobPlanItemAction(jobPlan.id, formData)
    if (result.success) {
      setShowAddItem(false)
      ;(e.target as HTMLFormElement).reset()
    } else {
      setItemError(result.error ?? 'Failed to add task.')
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!jobPlan) return
    await deleteJobPlanItemAction(jobPlan.id, itemId)
  }

  async function handleUpdateItem(itemId: string, formData: FormData) {
    if (!jobPlan) return
    setItemError(null)
    const result = await updateJobPlanItemAction(jobPlan.id, itemId, formData)
    if (!result.success) {
      setItemError(result.error ?? 'Failed to update task.')
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title={isEdit ? 'Edit Job Plan' : 'Add Job Plan'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput label="Name" name="name" required defaultValue={jobPlan?.name ?? ''} placeholder="Job plan name" />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
          <select
            name="site_id"
            required
            defaultValue={jobPlan?.site_id ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Description</label>
          <textarea
            name="description"
            defaultValue={jobPlan?.description ?? ''}
            rows={3}
            placeholder="Optional description"
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Frequency</label>
          <select
            name="frequency"
            required
            defaultValue={jobPlan?.frequency ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select frequency...</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Job Plan' : 'Create Job Plan'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {isEdit && isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              type="button"
              variant={jobPlan!.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleActive}
              disabled={loading}
            >
              {jobPlan!.is_active ? 'Deactivate Job Plan' : 'Reactivate Job Plan'}
            </Button>
          </div>
        )}
      </form>

      {/* Job Plan Items / Tasks section - only on edit */}
      {isEdit && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">Tasks</h3>
            {canWriteRole && (
              <button
                onClick={() => setShowAddItem(true)}
                className="flex items-center gap-1 text-xs text-eq-sky hover:text-eq-deep transition-colors font-medium"
              >
                <Plus className="w-3 h-3" /> Add Task
              </button>
            )}
          </div>

          {itemError && <p className="text-xs text-red-500 mb-2">{itemError}</p>}

          {items.length === 0 && !showAddItem && (
            <p className="text-sm text-eq-grey">No tasks yet.</p>
          )}

          <div className="space-y-2">
            {items.map((item) => (
              <JobPlanItemRow
                key={item.id}
                item={item}
                jobPlanId={jobPlan!.id}
                canWrite={canWriteRole}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
              />
            ))}
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="mt-3 p-3 border border-gray-200 rounded-md space-y-2">
              <FormInput label="Description" name="description" required placeholder="Task description" />
              <div className="grid grid-cols-2 gap-2">
                <FormInput label="Sort Order" name="sort_order" type="number" defaultValue={String(items.length)} />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Required</label>
                  <select name="is_required" defaultValue="true" className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white">
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm">Save Task</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddItem(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </SlidePanel>
  )
}

// Inline editable item row
function JobPlanItemRow({
  item,
  jobPlanId,
  canWrite: canWriteRole,
  onUpdate,
  onDelete,
}: {
  item: JobPlanItem
  jobPlanId: string
  canWrite: boolean
  onUpdate: (itemId: string, formData: FormData) => void
  onDelete: (itemId: string) => void
}) {
  const [editing, setEditing] = useState(false)

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    onUpdate(item.id, formData)
    setEditing(false)
  }

  if (editing) {
    return (
      <form onSubmit={handleSave} className="p-3 border border-eq-sky/30 rounded-md bg-eq-ice/30 space-y-2">
        <FormInput label="Description" name="description" required defaultValue={item.description} />
        <div className="grid grid-cols-2 gap-2">
          <FormInput label="Sort Order" name="sort_order" type="number" defaultValue={String(item.sort_order)} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Required</label>
            <select name="is_required" defaultValue={String(item.is_required)} className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">Save</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex items-center justify-between p-3 border border-gray-200 rounded-md">
      <div className="flex-1">
        <p className="text-sm text-eq-ink">{item.description}</p>
        <p className="text-xs text-eq-grey mt-0.5">
          Order: {item.sort_order} {item.is_required && <span className="text-eq-sky font-medium ml-2">Required</span>}
        </p>
      </div>
      {canWriteRole && (
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-gray-100 text-eq-grey text-xs">
            Edit
          </button>
          <button onClick={() => onDelete(item.id)} className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}
