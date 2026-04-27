'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createPmCalendarAction, updatePmCalendarAction } from './actions'
import { PM_CATEGORIES } from '@/lib/validations/pm-calendar'
import { formatSiteLabel } from '@/lib/utils/format'
import type { PmCalendarEntry, Site } from '@/lib/types'

interface PmCalendarFormProps {
  open: boolean
  onClose: () => void
  entry?: PmCalendarEntry | null
  sites: (Pick<Site, 'id' | 'name' | 'code'> & {
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  categories: string[]
  technicians: { id: string; email: string; full_name: string | null }[]
}

export function PmCalendarForm({ open, onClose, entry, sites, categories, technicians }: PmCalendarFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [staleNotice, setStaleNotice] = useState(false)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const isEdit = !!entry

  // Merge known categories with any custom ones from the database
  const allCategories = [...new Set([...PM_CATEGORIES, ...categories])].sort()

  function toLocalDatetime(isoStr: string | null | undefined): string {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    // Format as YYYY-MM-DDTHH:mm for datetime-local input
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setStaleNotice(false)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEdit
      ? await updatePmCalendarAction(entry!.id, formData, entry!.updated_at)
      : await createPmCalendarAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => handleClose(), 500)
    } else if ('stale' in result && result.stale) {
      setStaleNotice(true)
      setTimeout(() => {
        router.refresh()
        handleClose()
      }, 2000)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    setError(null)
    setStaleNotice(false)
    setSuccess(false)
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit PM Entry' : 'Add PM Entry'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Site */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site *</label>
          <select
            name="site_id"
            required
            defaultValue={entry?.site_id ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select a site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {formatSiteLabel(s)}
              </option>
            ))}
          </select>
        </div>

        {/* Title */}
        <FormInput label="Title" name="title" required defaultValue={entry?.title ?? ''} placeholder="e.g. Thermal Scanning — HV Switchgear" />

        {/* Category */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Category *</label>
          <select
            name="category"
            required
            defaultValue={entry?.category ?? 'Quarterly maintenance'}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            {allCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Location */}
        <FormInput label="Location" name="location" defaultValue={entry?.location ?? ''} placeholder="e.g. HV Switch Room" />

        {/* Start / End time */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Start Time *</label>
            <input
              type="datetime-local"
              name="start_time"
              required
              defaultValue={toLocalDatetime(entry?.start_time)}
              className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">End Time</label>
            <input
              type="datetime-local"
              name="end_time"
              defaultValue={toLocalDatetime(entry?.end_time)}
              className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
            />
          </div>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Status</label>
          <select
            name="status"
            defaultValue={entry?.status ?? 'scheduled'}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Assigned To */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Assigned To</label>
          <select
            name="assigned_to"
            defaultValue={entry?.assigned_to ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Unassigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name ?? t.email}</option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Description</label>
          <textarea
            name="description"
            defaultValue={entry?.description ?? ''}
            rows={4}
            placeholder="Task details, contractor contacts, special instructions..."
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 resize-none"
          />
        </div>

        {/* Notifications */}
        <div className="border-t border-gray-200 pt-4 mt-2">
          <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-3">Notifications</h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-eq-grey">Reminder days before</label>
              <input
                type="text"
                name="reminder_days_before"
                defaultValue={(entry?.reminder_days_before ?? []).join(', ')}
                placeholder="e.g. 7, 1"
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              />
              <p className="text-[11px] text-eq-grey">Comma-separated. Used by the supervisor digest.</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-eq-grey">Notification recipients</label>
              <input
                type="text"
                name="notification_recipients"
                defaultValue={(entry?.notification_recipients ?? []).join(', ')}
                placeholder="ops@example.com, supervisor@example.com"
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              />
              <p className="text-[11px] text-eq-grey">Optional cc list (in addition to assigned supervisor).</p>
            </div>
          </div>
        </div>

        {/* Feedback */}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {staleNotice && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            This entry was changed by someone else. Refreshing to show their changes...
          </p>
        )}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Entry' : 'Create Entry'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>Cancel</Button>
        </div>
      </form>
    </SlidePanel>
  )
}
