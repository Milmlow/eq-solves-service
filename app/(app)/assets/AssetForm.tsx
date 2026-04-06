'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { createAssetAction, updateAssetAction, toggleAssetActiveAction } from './actions'
import { formatDate } from '@/lib/utils/format'
import type { Asset, Site, JobPlan } from '@/lib/types'

interface AssetFormProps {
  open: boolean
  onClose: () => void
  asset?: Asset | null
  sites: Pick<Site, 'id' | 'name'>[]
  jobPlans?: Pick<JobPlan, 'id' | 'name' | 'frequency'>[]
  isAdmin: boolean
  canWrite: boolean
}

export function AssetForm({ open, onClose, asset, sites, jobPlans = [], isAdmin, canWrite: canWriteRole }: AssetFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)

  const isEdit = !!asset
  const showForm = !isEdit || editMode

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEdit
      ? await updateAssetAction(asset!.id, formData)
      : await createAssetAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => { onClose(); setEditMode(false) }, 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleToggleActive() {
    if (!asset) return
    setLoading(true)
    const result = await toggleAssetActiveAction(asset.id, !asset.is_active)
    setLoading(false)
    if (result.success) {
      onClose()
      setEditMode(false)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    setEditMode(false)
    setError(null)
    setSuccess(false)
  }

  // Detail view (read-only)
  if (isEdit && !showForm) {
    const siteName = sites.find((s) => s.id === asset!.site_id)?.name ?? '—'
    return (
      <SlidePanel open={open} onClose={handleClose} title={asset!.name}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <StatusBadge status={asset!.is_active ? 'active' : 'inactive'} />
            {canWriteRole && (
              <Button size="sm" onClick={() => setEditMode(true)}>Edit</Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Type</dt>
              <dd className="text-eq-ink mt-1">{asset!.asset_type}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Site</dt>
              <dd className="text-eq-ink mt-1">{siteName}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Manufacturer</dt>
              <dd className="text-eq-ink mt-1">{asset!.manufacturer ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Model</dt>
              <dd className="text-eq-ink mt-1">{asset!.model ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Serial Number</dt>
              <dd className="text-eq-ink mt-1">{asset!.serial_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Maximo ID</dt>
              <dd className="text-eq-ink mt-1">{asset!.maximo_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Location</dt>
              <dd className="text-eq-ink mt-1">{asset!.location ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Install Date</dt>
              <dd className="text-eq-ink mt-1">{asset!.install_date ? formatDate(asset!.install_date) : '—'}</dd>
            </div>
          </div>

          {jobPlans.length > 0 && (
            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Job Plans (Site)</h3>
              <ul className="space-y-1">
                {jobPlans.map((jp) => (
                  <li key={jp.id} className="text-sm text-eq-ink">
                    <a href={`/job-plans?search=${encodeURIComponent(jp.name)}`} className="text-eq-sky hover:text-eq-deep transition-colors">
                      {jp.name}
                    </a>
                    <span className="text-eq-grey ml-2 text-xs">({jp.frequency})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SlidePanel>
    )
  }

  // Create/Edit form
  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit Asset' : 'Add Asset'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">Identification</h3>
        <FormInput label="Name" name="name" required defaultValue={asset?.name ?? ''} placeholder="Asset name" />
        <FormInput label="Asset Type" name="asset_type" required defaultValue={asset?.asset_type ?? ''} placeholder="e.g. ACB, Switchboard" />
        <FormInput label="Manufacturer" name="manufacturer" defaultValue={asset?.manufacturer ?? ''} placeholder="Manufacturer" />
        <FormInput label="Model" name="model" defaultValue={asset?.model ?? ''} placeholder="Model" />
        <FormInput label="Serial Number" name="serial_number" defaultValue={asset?.serial_number ?? ''} placeholder="Serial number" />
        <FormInput label="Maximo ID" name="maximo_id" defaultValue={asset?.maximo_id ?? ''} placeholder="Maximo ID" />

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Location</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
          <select
            name="site_id"
            required
            defaultValue={asset?.site_id ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <FormInput label="Location" name="location" defaultValue={asset?.location ?? ''} placeholder="e.g. Level 2, DB-03" />

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Details</h3>
        <FormInput label="Install Date" name="install_date" type="date" defaultValue={asset?.install_date ?? ''} />

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Asset' : 'Create Asset'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>

        {isEdit && isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              type="button"
              variant={asset!.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleActive}
              disabled={loading}
            >
              {asset!.is_active ? 'Deactivate Asset' : 'Reactivate Asset'}
            </Button>
          </div>
        )}
      </form>
    </SlidePanel>
  )
}
