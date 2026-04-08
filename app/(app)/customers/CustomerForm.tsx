'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createCustomerAction, updateCustomerAction, toggleCustomerActiveAction } from './actions'
import type { Customer } from '@/lib/types'
import Link from 'next/link'

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

  const isEdit = !!customer

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
    setLoading(true)
    const result = await toggleCustomerActiveAction(customer.id, !customer.is_active)
    setLoading(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error ?? 'Something went wrong.')
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
        <FormInput
          label="Logo URL"
          name="logo_url"
          defaultValue={customer?.logo_url ?? ''}
          placeholder="https://example.com/logo.png"
          hint="Optional. PNG, JPEG, or SVG."
        />

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
              {customer!.is_active ? 'Deactivate Customer' : 'Reactivate Customer'}
            </Button>
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
