'use client'

import { useState } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { updateReportSettingsAction } from './actions'
import type { TenantSettings } from '@/lib/types'
import { Eye, EyeOff, Plus, Trash2, GripVertical } from 'lucide-react'

interface Props {
  settings: TenantSettings
}

export function ReportSettingsForm({ settings }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  // Section toggles
  const [showCover, setShowCover] = useState(settings.report_show_cover_page ?? true)
  const [showOverview, setShowOverview] = useState(settings.report_show_site_overview ?? true)
  const [showContents, setShowContents] = useState(settings.report_show_contents ?? true)
  const [showSummary, setShowSummary] = useState(settings.report_show_executive_summary ?? true)
  const [showSignOff, setShowSignOff] = useState(settings.report_show_sign_off ?? true)

  // Custom text
  const [headerText, setHeaderText] = useState(settings.report_header_text ?? '')
  const [footerText, setFooterText] = useState(settings.report_footer_text ?? '')

  // Company details
  const [companyName, setCompanyName] = useState(settings.report_company_name ?? '')
  const [companyAddress, setCompanyAddress] = useState(settings.report_company_address ?? '')
  const [companyAbn, setCompanyAbn] = useState(settings.report_company_abn ?? '')
  const [companyPhone, setCompanyPhone] = useState(settings.report_company_phone ?? '')

  // Sign-off fields
  const [signOffFields, setSignOffFields] = useState<string[]>(
    Array.isArray(settings.report_sign_off_fields) ? settings.report_sign_off_fields : ['Technician Signature', 'Supervisor Signature']
  )

  function addSignOffField() {
    setSignOffFields([...signOffFields, ''])
  }

  function removeSignOffField(idx: number) {
    setSignOffFields(signOffFields.filter((_, i) => i !== idx))
  }

  function updateSignOffField(idx: number, value: string) {
    const updated = [...signOffFields]
    updated[idx] = value
    setSignOffFields(updated)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const result = await updateReportSettingsAction({
      report_show_cover_page: showCover,
      report_show_site_overview: showOverview,
      report_show_contents: showContents,
      report_show_executive_summary: showSummary,
      report_show_sign_off: showSignOff,
      report_header_text: headerText || null,
      report_footer_text: footerText || null,
      report_company_name: companyName || null,
      report_company_address: companyAddress || null,
      report_company_abn: companyAbn || null,
      report_company_phone: companyPhone || null,
      report_sign_off_fields: signOffFields.filter(f => f.trim().length > 0),
    })

    setLoading(false)
    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  const sections = [
    { label: 'Cover Page', description: 'Title page with report name, site info, and logo', value: showCover, toggle: setShowCover },
    { label: 'Site Overview', description: 'Site details, dates, outstanding counts', value: showOverview, toggle: setShowOverview },
    { label: 'Contents Page', description: 'Table of contents with links to each asset section', value: showContents, toggle: setShowContents },
    { label: 'Executive Summary', description: 'KPI dashboard with pass rates, task breakdown, key findings', value: showSummary, toggle: setShowSummary },
    { label: 'Sign-off Page', description: 'Approval table with signature lines', value: showSignOff, toggle: setShowSignOff },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {/* Section Toggles */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Report Sections</h2>
        <p className="text-xs text-eq-grey mb-4">Choose which sections to include in generated reports. Asset detail sections are always included.</p>
        <div className="space-y-3">
          {sections.map(s => (
            <button
              key={s.label}
              type="button"
              onClick={() => s.toggle(!s.value)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors text-left hover:bg-gray-50"
              style={{ borderColor: s.value ? 'var(--eq-sky, #3DA8D8)' : '#e5e7eb' }}
            >
              <div>
                <p className="text-sm font-medium text-eq-ink">{s.label}</p>
                <p className="text-xs text-eq-grey">{s.description}</p>
              </div>
              {s.value ? (
                <Eye className="w-5 h-5 text-eq-sky shrink-0" />
              ) : (
                <EyeOff className="w-5 h-5 text-gray-300 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Company Details */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Company Details</h2>
        <p className="text-xs text-eq-grey mb-4">Shown on the cover page and report headers. Logo and brand colours are inherited from Tenant Settings.</p>
        <div className="space-y-4">
          <FormInput
            label="Company Name"
            name="report_company_name"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. SKS Technologies"
          />
          <FormInput
            label="Address"
            name="report_company_address"
            value={companyAddress}
            onChange={e => setCompanyAddress(e.target.value)}
            placeholder="e.g. 123 Industrial Ave, Sydney NSW 2000"
          />
          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="ABN"
              name="report_company_abn"
              value={companyAbn}
              onChange={e => setCompanyAbn(e.target.value)}
              placeholder="e.g. 12 345 678 901"
            />
            <FormInput
              label="Phone"
              name="report_company_phone"
              value={companyPhone}
              onChange={e => setCompanyPhone(e.target.value)}
              placeholder="e.g. +61 2 9876 5432"
            />
          </div>
        </div>
      </div>

      {/* Header / Footer */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Header & Footer Text</h2>
        <p className="text-xs text-eq-grey mb-4">Custom text shown in the report header and footer on every page. Leave blank to use defaults.</p>
        <div className="space-y-4">
          <FormInput
            label="Header Text"
            name="report_header_text"
            value={headerText}
            onChange={e => setHeaderText(e.target.value)}
            placeholder="e.g. CONFIDENTIAL — SKS Technologies Pty Ltd"
          />
          <FormInput
            label="Footer Text"
            name="report_footer_text"
            value={footerText}
            onChange={e => setFooterText(e.target.value)}
            placeholder="e.g. © 2026 SKS Technologies. All rights reserved."
          />
        </div>
      </div>

      {/* Sign-off Fields */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Sign-off Fields</h2>
        <p className="text-xs text-eq-grey mb-4">Customise the signature lines on the sign-off page. Add or remove as needed.</p>
        <div className="space-y-2">
          {signOffFields.map((field, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
              <input
                type="text"
                value={field}
                onChange={e => updateSignOffField(idx, e.target.value)}
                placeholder="e.g. Client Representative"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
              />
              {signOffFields.length > 1 && (
                <button type="button" onClick={() => removeSignOffField(idx)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addSignOffField}
            className="flex items-center gap-1 text-xs font-medium text-eq-sky hover:text-eq-deep transition-colors mt-2"
          >
            <Plus className="w-4 h-4" /> Add field
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">Report settings saved.</p>}

      <Button type="submit" disabled={loading}>
        {loading ? 'Saving...' : 'Save Report Settings'}
      </Button>
    </form>
  )
}
