'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { MediaPicker } from '@/components/ui/MediaPicker'
import { createCustomerAction, updateCustomerAction, toggleCustomerActiveAction, uploadCustomerLogoAction } from './actions'
import { cascadeArchiveAction } from '@/app/(app)/admin/archive/actions'
import type { Customer } from '@/lib/types'
import Link from 'next/link'
import { X, Upload, ImageIcon } from 'lucide-react'

interface CustomerFormProps {
  open: boolean
  onClose: () => void
  customer?: Customer | null
  isAdmin: boolean
}

export function CustomerForm({ open, onClose, customer, isAdmin }: CustomerFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(customer?.logo_url ?? null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [logoMode, setLogoMode] = useState<'library' | 'upload'>(customer?.logo_url ? 'library' : 'library')

  const isEdit = !!customer

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    if (!file) return

    const maxSize = 500 * 1024 // 500 KB
    if (file.size > maxSize) {
      setError('Logo file must be less than 500 KB.')
      return
    }

    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      setError('Please use PNG, JPG, or SVG format.')
      return
    }

    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setLogoPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
    setError(null)
  }

  async function handleUploadLogo() {
    if (!logoFile || !customer) return
    setUploading(true)
    const formData = new FormData()
    formData.append('file', logoFile)
    const result = await uploadCustomerLogoAction(customer.id, formData)
    setUploading(false)
    if (result.success) {
      setLogoFile(null)
      setSuccess(true)
      setTimeout(() => onClose(), 500)
    } else {
      setError(result.error ?? 'Failed to upload logo.')
    }
  }

  async function handleRemoveLogo() {
    if (!customer) return
    setLogoPreview(null)
    setLogoFile(null)
    // Update customer to clear logo_url
    const formData = new FormData()
    formData.append('name', customer.name)
    formData.append('code', customer.code ?? '')
    formData.append('email', customer.email ?? '')
    formData.append('phone', customer.phone ?? '')
    formData.append('address', customer.address ?? '')
    formData.append('logo_url', '')
    const result = await updateCustomerAction(customer.id, formData)
    if (!result.success) {
      setError(result.error ?? 'Failed to remove logo.')
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEdit
      ? await updateCustomerAction(customer!.id, formData)
      : await createCustomerAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => onClose(), 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleToggleActive() {
    if (!customer) return
    // Reactivating is simple — flip the flag.
    if (!customer.is_active) {
      setLoading(true)
      const result = await toggleCustomerActiveAction(customer.id, true)
      setLoading(false)
      if (result.success) onClose()
      else setError(result.error ?? 'Something went wrong.')
      return
    }
    // Archiving cascades: customer + sites + assets all flip is_active=false
    // so the whole tree lands in /admin/archive together. Reversible inside
    // the grace window via the Archive page.
    if (!confirm(`Archive "${customer.name}" and all its sites and assets? Everything will move to /admin/archive and auto-delete after the grace period unless restored.`)) return
    setLoading(true)
    const fd = new FormData()
    fd.set('entity_type', 'customer')
    fd.set('entity_id', customer.id)
    const result = await cascadeArchiveAction(fd)
    setLoading(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
    } else {
      onClose()
    }
  }

  // Count of sites for this customer (shown on edit)
  const sitesLink = customer ? `/sites?customer_id=${customer.id}` : null

  return (
    <SlidePanel open={open} onClose={onClose} title={isEdit ? 'Edit Customer' : 'Add Customer'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput
          label="Name"
          name="name"
          required
          defaultValue={customer?.name ?? ''}
          placeholder="Customer name"
        />
        <FormInput
          label="Code"
          name="code"
          defaultValue={customer?.code ?? ''}
          placeholder="e.g. EQX"
        />
        <FormInput
          label="Email"
          name="email"
          type="email"
          defaultValue={customer?.email ?? ''}
          placeholder="contact@example.com"
        />
        <FormInput
          label="Phone"
          name="phone"
          defaultValue={customer?.phone ?? ''}
          placeholder="+61 400 000 000"
        />
        <FormInput
          label="Address"
          name="address"
          defaultValue={customer?.address ?? ''}
          placeholder="Full address"
        />
        {/* Logo Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-eq-ink">Logo</label>
          {/* Mode toggle */}
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-md w-fit">
            <button
              type="button"
              onClick={() => setLogoMode('library')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                logoMode === 'library' ? 'bg-white text-eq-ink shadow-sm' : 'text-eq-grey hover:text-eq-ink'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" /> Media Library
            </button>
            <button
              type="button"
              onClick={() => setLogoMode('upload')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                logoMode === 'upload' ? 'bg-white text-eq-ink shadow-sm' : 'text-eq-grey hover:text-eq-ink'
              }`}
            >
              <Upload className="w-3.5 h-3.5" /> Direct Upload
            </button>
          </div>

          {logoMode === 'library' ? (
            <div className="space-y-2">
              <MediaPicker
                value={logoPreview}
                onChange={(url) => {
                  setLogoPreview(url)
                  setLogoFile(null)
                }}
                category="customer_logo"
                placeholder="Select logo from media library…"
              />
              {/* Hidden input so logo_url is included in FormData on create */}
              <input type="hidden" name="logo_url" value={logoPreview ?? ''} />
            </div>
          ) : (
            <>
              {logoPreview ? (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoPreview} alt="Logo preview" className="w-12 h-12 object-contain" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-eq-ink">{logoFile?.name ?? 'Current logo'}</p>
                    <p className="text-xs text-eq-grey">{logoFile ? `${(logoFile.size / 1024).toFixed(1)} KB` : 'Uploaded'}</p>
                  </div>
                  {isEdit && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      disabled={uploading}
                      className="p-1.5 text-eq-grey hover:text-red-500 transition-colors"
                      title="Remove logo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : null}
              {!logoPreview ? (
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    onChange={handleLogoChange}
                    className="block w-full text-sm text-eq-grey
                      file:mr-4 file:py-2 file:px-4
                      file:rounded file:border-0
                      file:text-sm file:font-medium
                      file:bg-eq-ice file:text-eq-deep
                      hover:file:bg-gray-100"
                  />
                  <p className="text-xs text-eq-grey">Max 500 KB, PNG or JPG recommended</p>
                </div>
              ) : null}
              {logoFile && isEdit && (
                <Button type="button" variant="secondary" size="sm" onClick={handleUploadLogo} disabled={uploading}>
                  {uploading ? 'Uploading...' : 'Upload Logo'}
                </Button>
              )}
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Customer' : 'Create Customer'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {isEdit && isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              type="button"
              variant={customer!.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleActive}
              disabled={loading}
            >
              {customer!.is_active ? 'Archive Customer (cascade)' : 'Reactivate Customer'}
            </Button>
            {customer!.is_active && (
              <p className="text-xs text-eq-grey mt-2">
                Cascades to all sites and assets under this customer. Reversible from /admin/archive inside the grace period.
              </p>
            )}
          </div>
        )}

        {isEdit && sitesLink && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Sites</h3>
            <Link
              href={sitesLink}
              className="text-sm text-eq-sky hover:text-eq-deep transition-colors"
            >
              View sites for this customer →
            </Link>
          </div>
        )}
      </form>
    </SlidePanel>
  )
}
