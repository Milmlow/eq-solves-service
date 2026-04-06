'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createCheckAction } from './actions'
import type { JobPlan, Site, Profile } from '@/lib/types'
import { formatFrequency } from '@/lib/utils/format'
import type { Frequency } from '@/lib/types'

interface CreateCheckFormProps {
  open: boolean
  onClose: () => void
  jobPlans: (Pick<JobPlan, 'id' | 'name' | 'site_id' | 'frequency'> & { sites?: { name: string } | null })[]
  sites: Pick<Site, 'id' | 'name'>[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
}

export function CreateCheckForm({ open, onClose, jobPlans, sites, technicians }: CreateCheckFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedJobPlan, setSelectedJobPlan] = useState('')

  const jobPlan = jobPlans.find((jp) => jp.id === selectedJobPlan)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    // Auto-fill site_id from job plan
    if (jobPlan) {
      formData.set('site_id', jobPlan.site_id)
    }

    const result = await createCheckAction(formData)
    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => { onClose(); setSelectedJobPlan('') }, 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title="Create Maintenance Check">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Job Plan</label>
          <select
            name="job_plan_id"
            required
            value={selectedJobPlan}
            onChange={(e) => setSelectedJobPlan(e.target.value)}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select job plan...</option>
            {jobPlans.map((jp) => (
              <option key={jp.id} value={jp.id}>
                {jp.name} — {jp.sites?.name ?? 'Unknown site'} ({formatFrequency(jp.frequency as Frequency)})
              </option>
            ))}
          </select>
        </div>

        {jobPlan && (
          <div className="text-xs text-eq-grey bg-eq-ice/50 rounded-md p-3">
            Site: <span className="font-medium text-eq-ink">{jobPlan.sites?.name}</span> ·
            Frequency: <span className="font-medium text-eq-ink">{formatFrequency(jobPlan.frequency as Frequency)}</span>
          </div>
        )}

        {/* Hidden site_id — auto-populated from job plan */}
        <input type="hidden" name="site_id" value={jobPlan?.site_id ?? ''} />

        <FormInput
          label="Due Date"
          name="due_date"
          type="date"
          required
        />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Assign To</label>
          <select
            name="assigned_to"
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">— Unassigned —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name ?? t.email}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
          <textarea
            name="notes"
            rows={3}
            placeholder="Optional notes for this check"
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Check created with tasks from job plan.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading || !selectedJobPlan}>
            {loading ? 'Creating...' : 'Create Check'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SlidePanel>
  )
}
