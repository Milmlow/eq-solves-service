'use client'

import { useState, useCallback } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createCheckAction, previewCheckAssetsAction } from './actions'
import type { JobPlan, Site, Profile } from '@/lib/types'

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
  { value: '2yr', label: '2 Year' },
  { value: '3yr', label: '3 Year' },
  { value: '5yr', label: '5 Year' },
  { value: '8yr', label: '8 Year' },
  { value: '10yr', label: '10 Year' },
] as const

interface PreviewAsset {
  id: string
  name: string
  maximo_id: string | null
  location: string | null
  job_plan_name: string | null
  task_count: number
}

interface CreateCheckFormProps {
  open: boolean
  onClose: () => void
  jobPlans: Pick<JobPlan, 'id' | 'name' | 'code'>[]
  sites: Pick<Site, 'id' | 'name'>[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
}

export function CreateCheckForm({ open, onClose, jobPlans, sites, technicians }: CreateCheckFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  // Form state
  const [siteId, setSiteId] = useState('')
  const [frequency, setFrequency] = useState('')
  const [isDarkSite, setIsDarkSite] = useState(false)
  const [jobPlanId, setJobPlanId] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [manualMaximoIds, setManualMaximoIds] = useState('')

  // Preview state
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [hasPreview, setHasPreview] = useState(false)

  const resetForm = useCallback(() => {
    setSiteId('')
    setFrequency('')
    setIsDarkSite(false)
    setJobPlanId('')
    setManualMode(false)
    setManualMaximoIds('')
    setPreviewAssets([])
    setPreviewTotal(0)
    setHasPreview(false)
    setError(null)
    setSuccess(false)
  }, [])

  async function handlePreview() {
    if (!siteId || !frequency) return
    setPreviewing(true)
    setError(null)

    const result = await previewCheckAssetsAction(siteId, frequency, isDarkSite, jobPlanId || null)
    setPreviewing(false)

    if (result.success) {
      setPreviewAssets(result.assets as PreviewAsset[])
      setPreviewTotal(result.totalTasks)
      setHasPreview(true)
    } else {
      setError(result.error ?? 'Failed to preview assets.')
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set('is_dark_site', isDarkSite ? 'true' : 'false')

    // If manual mode, we need to resolve Maximo IDs to asset UUIDs on the server
    // For now, pass the preview asset IDs
    if (!manualMode && previewAssets.length > 0) {
      // Path A: pass the previewed asset IDs
      formData.set('manual_asset_ids', JSON.stringify(previewAssets.map((a) => a.id)))
    }

    const result = await createCheckAction(formData)
    setLoading(false)

    if (result.success) {
      setSuccess(true)
      const msg = `Check created: ${result.assetCount ?? 0} assets, ${result.taskCount ?? 0} tasks`
      setTimeout(() => { onClose(); resetForm() }, 1500)
      setError(null)
      // Show success with counts
      setSuccess(true)
      setPreviewTotal(0)
      setPreviewAssets([])
      // Override success message
      const el = document.getElementById('create-check-success')
      if (el) el.textContent = msg
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    resetForm()
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title="New Maintenance Check">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Site */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site *</label>
          <select
            name="site_id"
            required
            value={siteId}
            onChange={(e) => { setSiteId(e.target.value); setHasPreview(false) }}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Frequency */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Maintenance Frequency *</label>
          <select
            name="frequency"
            required
            value={frequency}
            onChange={(e) => { setFrequency(e.target.value); setHasPreview(false) }}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select frequency...</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* Dark Site Toggle */}
        <label className="flex items-center gap-2 text-sm text-eq-ink">
          <input
            type="checkbox"
            checked={isDarkSite}
            onChange={(e) => { setIsDarkSite(e.target.checked); setHasPreview(false) }}
            className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
          />
          Dark Site Test
        </label>

        {/* Job Plan Filter (optional) */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Job Plan (optional filter)</label>
          <select
            name="job_plan_id"
            value={jobPlanId}
            onChange={(e) => { setJobPlanId(e.target.value); setHasPreview(false) }}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">All job plans</option>
            {jobPlans.map((jp) => (
              <option key={jp.id} value={jp.id}>
                {jp.name}{jp.code ? ` (${jp.code})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Preview Button */}
        {siteId && frequency && !manualMode && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePreview}
            disabled={previewing}
          >
            {previewing ? 'Loading...' : hasPreview ? 'Refresh Preview' : 'Preview Assets'}
          </Button>
        )}

        {/* Preview Results */}
        {hasPreview && (
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="px-3 py-2 bg-eq-ice/50 border-b border-gray-200 flex justify-between">
              <span className="text-xs font-bold text-eq-grey uppercase">
                {previewAssets.length} Assets · {previewTotal} Tasks
              </span>
            </div>
            {previewAssets.length === 0 ? (
              <p className="text-sm text-eq-grey p-3">No assets found matching criteria.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                {previewAssets.map((a) => (
                  <div key={a.id} className="px-3 py-2 text-xs">
                    <div className="flex justify-between">
                      <span className="font-medium text-eq-ink">{a.maximo_id ?? '—'}</span>
                      <span className="text-eq-grey">{a.task_count} tasks</span>
                    </div>
                    <div className="text-eq-grey truncate">{a.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Manual Mode Toggle */}
        <label className="flex items-center gap-2 text-sm text-eq-ink">
          <input
            type="checkbox"
            checked={manualMode}
            onChange={(e) => { setManualMode(e.target.checked); setHasPreview(false) }}
            className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
          />
          Manual Assets (paste Maximo IDs)
        </label>

        {manualMode && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Maximo Asset IDs (one per line)</label>
            <textarea
              value={manualMaximoIds}
              onChange={(e) => setManualMaximoIds(e.target.value)}
              rows={4}
              placeholder="Paste Maximo IDs, one per line..."
              className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 font-mono"
            />
          </div>
        )}

        <hr className="border-gray-200" />

        {/* Custom Name */}
        <FormInput label="Custom Name" name="custom_name" placeholder="Optional name for this check" />

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Start Date *" name="start_date" type="date" required />
          <FormInput label="Due Date *" name="due_date" type="date" required />
        </div>

        {/* Owner / Assigned To */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Owner</label>
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

        {/* Maximo References */}
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Maximo WO #" name="maximo_wo_number" placeholder="Work order number" />
          <FormInput label="Maximo PM #" name="maximo_pm_number" placeholder="PM number" />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
          <textarea
            name="notes"
            rows={2}
            placeholder="Optional notes"
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p id="create-check-success" className="text-sm text-green-600">Check created successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading || (!siteId || !frequency)}>
            {loading ? 'Creating...' : 'Create Check'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SlidePanel>
  )
}
