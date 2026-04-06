'use client'

import { useState } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { updateTenantSettingsAction } from './actions'
import type { TenantSettings } from '@/lib/types'

interface TenantSettingsFormProps {
  settings: TenantSettings
}

export function TenantSettingsForm({ settings }: TenantSettingsFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  // Live preview of colours
  const [primary, setPrimary] = useState(settings.primary_colour)
  const [deep, setDeep] = useState(settings.deep_colour)
  const [ice, setIce] = useState(settings.ice_colour)
  const [ink, setInk] = useState(settings.ink_colour)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await updateTenantSettingsAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {/* Branding Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Branding</h2>
        <div className="space-y-4">
          <FormInput
            label="Product Name"
            name="product_name"
            required
            defaultValue={settings.product_name}
            placeholder="e.g. EQ Solves"
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Primary Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="primary_colour"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{primary}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Deep Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="deep_colour"
                  value={deep}
                  onChange={(e) => setDeep(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{deep}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Ice Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="ice_colour"
                  value={ice}
                  onChange={(e) => setIce(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{ice}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Ink Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="ink_colour"
                  value={ink}
                  onChange={(e) => setInk(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{ink}</span>
              </div>
            </div>
          </div>

          {/* Colour preview strip */}
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Preview</p>
            <div className="flex rounded-md overflow-hidden h-8">
              <div className="flex-1" style={{ backgroundColor: primary }} />
              <div className="flex-1" style={{ backgroundColor: deep }} />
              <div className="flex-1" style={{ backgroundColor: ice }} />
              <div className="flex-1" style={{ backgroundColor: ink }} />
            </div>
            <div className="flex text-[10px] text-eq-grey mt-1">
              <span className="flex-1">Primary</span>
              <span className="flex-1">Deep</span>
              <span className="flex-1">Ice</span>
              <span className="flex-1">Ink</span>
            </div>
          </div>

          <FormInput
            label="Logo URL"
            name="logo_url"
            defaultValue={settings.logo_url ?? ''}
            placeholder="https://example.com/logo.svg"
            hint="File upload coming in a future sprint"
          />
        </div>
      </div>

      {/* Contact Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Contact</h2>
        <FormInput
          label="Support Email"
          name="support_email"
          type="email"
          defaultValue={settings.support_email ?? ''}
          placeholder="support@company.com"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">Settings saved. Reload to see colour changes across the app.</p>}

      <Button type="submit" disabled={loading}>
        {loading ? 'Saving...' : 'Save Settings'}
      </Button>
    </form>
  )
}
