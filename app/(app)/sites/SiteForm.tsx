'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { MediaPicker } from '@/components/ui/MediaPicker'
import { createSiteAction, updateSiteAction, toggleSiteActiveAction } from './actions'
import { cascadeArchiveAction } from '@/app/(app)/admin/archive/actions'
import type { Site, Customer } from '@/lib/types'

interface SiteFormProps {
  open: boolean
  onClose: () => void
  site?: Site | null
  customers: Pick<Customer, 'id' | 'name'>[]
  isAdmin: boolean
}

export function SiteForm({ open, onClose, site, customers, isAdmin }: SiteFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(site?.photo_url ?? null)

  const isEdit = !!site

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEdit
      ? await updateSiteAction(site!.id, formData)
      : await createSiteAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => onClose(), 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleToggleActive() {
    if (!site) return
    // Reactivating is simple — flip the flag.
    if (!site.is_active) {
      setLoading(true)
      const result = await toggleSiteActiveAction(site.id, true)
      setLoading(false)
      if (result.success) onClose()
      else setError(result.error ?? 'Something went wrong.')
      return
    }
    // Archiving cascades: site + assets all flip is_active=false so the
    // whole subtree lands in /admin/archive together. Reversible inside
    // the grace window via the Archive page.
    if (!confirm(`Archive "${site.name}" and all its assets? Everything will move to /admin/archive and auto-delete after the grace period unless restored.`)) return
    setLoading(true)
    const fd = new FormData()
    fd.set('entity_type', 'site')
    fd.set('entity_id', site.id)
    const result = await cascadeArchiveAction(fd)
    setLoading(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
    } else {
      onClose()
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title={isEdit ? 'Edit Site' : 'Add Site'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput
          label="Name"
          name="name"
          required
          defaultValue={site?.name ?? ''}
          placeholder="Site name"
        />
        <FormInput
          label="Code"
          name="code"
          defaultValue={site?.code ?? ''}
          placeholder="e.g. SY1"
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</label>
          <select
            name="customer_id"
            defaultValue={site?.customer_id ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">— No customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <FormInput
          label="Address"
          name="address"
          defaultValue={site?.address ?? ''}
          placeholder="Street address"
        />
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="City"
            name="city"
            defaultValue={site?.city ?? ''}
            placeholder="City"
          />
          <FormInput
            label="State"
            name="state"
            defaultValue={site?.state ?? ''}
            placeholder="e.g. NSW"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Postcode"
            name="postcode"
            defaultValue={site?.postcode ?? ''}
            placeholder="2000"
          />
          <FormInput
            label="Country"
            name="country"
            defaultValue={site?.country ?? 'Australia'}
          />
        </div>

        {/* Site Photo */}
        <div className="space-y-1">
          <MediaPicker
            label="Site Photo"
            value={photoUrl}
            onChange={(url) => setPhotoUrl(url)}
            category="site_photo"
            placeholder="Select site photo from media library…"
          />
          <input type="hidden" name="photo_url" value={photoUrl ?? ''} />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Site' : 'Create Site'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {isEdit && isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              type="button"
              variant={site!.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleActive}
              disabled={loading}
            >
              {site!.is_active ? 'Archive Site (cascade)' : 'Reactivate Site'}
            </Button>
            {site!.is_active && (
              <p className="text-xs text-eq-grey mt-2">
                Cascades to all assets under this site. Reversible from /admin/archive inside the grace period.
              </p>
            )}
          </div>
        )}
      </form>
    </SlidePanel>
  )
}
