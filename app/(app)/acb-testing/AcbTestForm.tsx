'use client'

import { useState, useMemo } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createAcbTestAction, updateAcbTestAction } from './actions'
import type { AcbTest, Asset, Site, Profile } from '@/lib/types'

interface AcbTestFormProps {
  open: boolean
  onClose: () => void
  test?: AcbTest | null
  assets: Pick<Asset, 'id' | 'name' | 'asset_type' | 'site_id'>[]
  sites: Pick<Site, 'id' | 'name'>[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
}

export function AcbTestForm({ open, onClose, test, assets, sites, technicians }: AcbTestFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState(test?.asset_id ?? '')

  const isEdit = !!test

  // Auto-resolve site from selected asset
  const resolvedSiteId = useMemo(() => {
    if (selectedAssetId) {
      const asset = assets.find((a) => a.id === selectedAssetId)
      return asset?.site_id ?? ''
    }
    return test?.site_id ?? ''
  }, [selectedAssetId, assets, test])

  const resolvedSiteName = useMemo(() => {
    if (!resolvedSiteId) return ''
    return sites.find((s) => s.id === resolvedSiteId)?.name ?? ''
  }, [resolvedSiteId, sites])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set('site_id', resolvedSiteId)

    const result = isEdit
      ? await updateAcbTestAction(test!.id, formData)
      : await createAcbTestAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => handleClose(), 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    setError(null)
    setSuccess(false)
    setSelectedAssetId(test?.asset_id ?? '')
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit ACB Test' : 'Add ACB Test'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Asset selection */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Asset</label>
          <select
            name="asset_id"
            required
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select asset...</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.asset_type})
              </option>
            ))}
          </select>
        </div>

        {/* Auto-resolved site */}
        {resolvedSiteName && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
            <div className="h-10 px-4 flex items-center border border-gray-100 rounded-md text-sm text-eq-grey bg-gray-50">
              {resolvedSiteName}
            </div>
          </div>
        )}

        <FormInput
          label="Test Date"
          name="test_date"
          type="date"
          required
          defaultValue={test?.test_date ?? new Date().toISOString().split('T')[0]}
        />

        {/* Tested By */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Tested By</label>
          <select
            name="tested_by"
            defaultValue={test?.tested_by ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Not assigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name ?? t.email}
              </option>
            ))}
          </select>
        </div>

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Circuit Breaker Details</h3>

        <div className="grid grid-cols-2 gap-4">
          <FormInput label="CB Make" name="cb_make" defaultValue={test?.cb_make ?? ''} placeholder="e.g. ABB, Schneider" />
          <FormInput label="CB Model" name="cb_model" defaultValue={test?.cb_model ?? ''} placeholder="e.g. Emax E2" />
          <FormInput label="CB Serial" name="cb_serial" defaultValue={test?.cb_serial ?? ''} placeholder="Serial number" />
          <FormInput label="CB Rating" name="cb_rating" defaultValue={(test as any)?.cb_rating ?? ''} placeholder="e.g. 630A" />
          <FormInput label="CB Poles" name="cb_poles" defaultValue={(test as any)?.cb_poles ?? ''} placeholder="e.g. 3P" />
          <FormInput label="Trip Unit" name="trip_unit" defaultValue={(test as any)?.trip_unit ?? ''} placeholder="e.g. Electronic" />
        </div>

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Trip Settings (Optional)</h3>

        <div className="grid grid-cols-4 gap-4">
          <FormInput label="Ir (A)" name="trip_settings_ir" defaultValue={(test as any)?.trip_settings_ir ?? ''} placeholder="Rated current" />
          <FormInput label="Isd (A)" name="trip_settings_isd" defaultValue={(test as any)?.trip_settings_isd ?? ''} placeholder="Short delay" />
          <FormInput label="Ii (A)" name="trip_settings_ii" defaultValue={(test as any)?.trip_settings_ii ?? ''} placeholder="Instantaneous" />
          <FormInput label="Ig (A)" name="trip_settings_ig" defaultValue={(test as any)?.trip_settings_ig ?? ''} placeholder="Ground" />
        </div>

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Test Details</h3>

        {/* Test Type */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Test Type</label>
          <select
            name="test_type"
            defaultValue={test?.test_type ?? 'Routine'}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="Initial">Initial</option>
            <option value="Routine">Routine</option>
            <option value="Special">Special</option>
          </select>
        </div>

        {/* Overall Result */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Overall Result</label>
          <select
            name="overall_result"
            defaultValue={test?.overall_result ?? 'Pending'}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="Pending">Pending</option>
            <option value="Pass">Pass</option>
            <option value="Fail">Fail</option>
            <option value="Defect">Defect</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
          <textarea
            name="notes"
            defaultValue={test?.notes ?? ''}
            rows={3}
            placeholder="Optional notes..."
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Test' : 'Create Test'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SlidePanel>
  )
}
