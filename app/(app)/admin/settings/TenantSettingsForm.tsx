'use client'

import { useState, useRef } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { updateTenantSettingsAction, uploadLogoAction } from './actions'
import { extractColoursFromImage } from '@/lib/utils/extract-colours'
import type { TenantSettings } from '@/lib/types'
import { Upload, Wand2 } from 'lucide-react'

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

  // Logo
  const [logoUrl, setLogoUrl] = useState(settings.logo_url ?? '')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    // Ensure logo_url is current
    formData.set('logo_url', logoUrl)
    const result = await updateTenantSettingsAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLogoFile(file)
    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('logo', file)
    const result = await uploadLogoAction(formData)

    setUploading(false)
    if (result.success && result.url) {
      setLogoUrl(result.url)
    } else {
      setUploadError(result.error ?? 'Upload failed.')
    }
  }

  async function handleExtractColours() {
    if (!logoUrl && !logoFile) return
    setExtracting(true)
    // Prefer the local file (avoids CORS), fall back to URL
    const source = logoFile ?? logoUrl
    const colours = await extractColoursFromImage(source)
    setExtracting(false)
    if (colours) {
      setPrimary(colours.primary)
      setDeep(colours.deep)
      setIce(colours.ice)
      setInk(colours.ink)
    } else {
      setUploadError('Could not extract colours. Try uploading the logo directly.')
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

          {/* Logo Upload */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Logo</label>
            <div className="flex items-start gap-4">
              {/* Preview */}
              <div className="w-24 h-24 border border-gray-200 rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden shrink-0">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-xs text-eq-grey">No logo</span>
                )}
              </div>
              <div className="space-y-2 flex-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <Upload className="w-4 h-4 mr-1" />
                    {uploading ? 'Uploading...' : 'Upload Logo'}
                  </Button>
                  {logoUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleExtractColours}
                      disabled={extracting}
                    >
                      <Wand2 className="w-4 h-4 mr-1" />
                      {extracting ? 'Extracting...' : 'Extract Colours'}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-eq-grey">PNG, JPEG, SVG or WebP. Max 2MB.</p>
                {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
                <FormInput
                  label="Or enter URL"
                  name="logo_url_display"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.svg"
                />
              </div>
            </div>
          </div>
          {/* Hidden input for form submission */}
          <input type="hidden" name="logo_url" value={logoUrl} />

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

      <Button type="submit" disabled={loading}>
        {loading ? 'Saving...' : 'Save Settings'}
      </Button>
    </form>
  )
}
