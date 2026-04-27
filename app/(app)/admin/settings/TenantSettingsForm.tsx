'use client'

import { useState } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { MediaPicker } from '@/components/ui/MediaPicker'
import { updateTenantSettingsAction } from './actions'
import { extractColoursFromImage } from '@/lib/utils/extract-colours'
import type { TenantSettings } from '@/lib/types'
import { Wand2, RotateCcw } from 'lucide-react'

const DEFAULT_COLOURS = {
  primary: '#3DA8D8',
  deep: '#2986B4',
  ice: '#EAF5FB',
  ink: '#1A1A2E',
} as const

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

  // Logos — picked from Media Library (single source of truth).
  // Uploads happen in Admin → Media Library; this form just references.
  const [logoUrl, setLogoUrl] = useState(settings.logo_url ?? '')
  const [logoUrlOnDark, setLogoUrlOnDark] = useState(
    (settings as unknown as { logo_url_on_dark?: string | null }).logo_url_on_dark ?? '',
  )
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set('logo_url', logoUrl)
    formData.set('logo_url_on_dark', logoUrlOnDark)
    const result = await updateTenantSettingsAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleExtractColours() {
    if (!logoUrl) {
      setExtractError('Pick a logo from Media Library first.')
      return
    }
    setExtractError(null)
    setExtracting(true)
    const colours = await extractColoursFromImage(logoUrl)
    setExtracting(false)
    if (colours) {
      setPrimary(colours.primary)
      setDeep(colours.deep)
      setIce(colours.ice)
      setInk(colours.ink)
    } else {
      setExtractError('Could not extract colours from this logo.')
    }
  }

  function handleRestoreDefaults() {
    setPrimary(DEFAULT_COLOURS.primary)
    setDeep(DEFAULT_COLOURS.deep)
    setIce(DEFAULT_COLOURS.ice)
    setInk(DEFAULT_COLOURS.ink)
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

          {/* Light-surface logo — single source of truth: Media Library.
              Upload via Admin → Media Library, then pick here. */}
          <MediaPicker
            label="Logo (Light Surface)"
            value={logoUrl || null}
            onChange={(url) => setLogoUrl(url ?? '')}
            category="report_image"
            surface="light"
            previewBackground="light"
            placeholder="Select tenant logo from Media Library…"
          />
          <p className="text-xs text-eq-grey -mt-2">
            Used in headers, body sections, and email signatures.
            Upload variants via Admin → Media Library.
          </p>

          {/* Dark-surface logo variant */}
          <MediaPicker
            label="Logo on Dark Surfaces"
            value={logoUrlOnDark || null}
            onChange={(url) => setLogoUrlOnDark(url ?? '')}
            category="report_image"
            surface="dark"
            previewBackground="dark"
            placeholder="Select dark-surface logo from Media Library…"
          />
          <p className="text-xs text-eq-grey -mt-2">
            Used on report covers and dark banners. Leave empty to fall back
            to the light logo.
          </p>

          {/* Hidden inputs for form submission */}
          <input type="hidden" name="logo_url" value={logoUrl} />
          <input type="hidden" name="logo_url_on_dark" value={logoUrlOnDark} />

          {/* Extract / Restore actions */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExtractColours}
              disabled={extracting || !logoUrl}
            >
              <Wand2 className="w-4 h-4 mr-1" />
              {extracting ? 'Extracting…' : 'Extract Colours from Logo'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRestoreDefaults}
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              Restore Defaults
            </Button>
          </div>
          {extractError && <p className="text-xs text-red-500">{extractError}</p>}

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

      <Button type="submit" loading={loading}>
        Save Settings
      </Button>
    </form>
  )
}
