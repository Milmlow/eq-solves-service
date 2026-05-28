'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { SplitButton } from '@/components/ui/SplitButton'

/**
 * Replaces the old "Print — Simple" / "Print — Detailed" pair with a single
 * action button + caret dropdown. Default action is the Standard report
 * (covers most use cases). Dropdown lets the user override to Summary or
 * Detailed for a given print.
 *
 * Each option fetches /api/maintenance-checklist and triggers a blob download
 * rather than window.open() — required for Shell iframe where allow-popups
 * is not set.
 */
/**
 * Relabelled 26-Apr-2026 (audit item 9): "Print Report" → "Field Run-Sheet".
 * The output is a printable checklist for the tech to fill in onsite, not
 * the customer-facing PDF. The customer-facing PDF is the separate
 * "Customer Report" button (Download Report) elsewhere on this page.
 */
export function PrintReportSplit({ checkId }: { checkId: string }) {
  const [loading, setLoading] = useState(false)

  async function download(format: 'summary' | 'standard' | 'detailed') {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/maintenance-checklist?check_id=${checkId}&format=${format}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const match = disposition?.match(/filename="(.+?)"/)
      a.download = match?.[1] ?? `Field Run-Sheet.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <SplitButton
      variant="gray"
      icon={<Printer className="w-4 h-4" />}
      label="Field Run-Sheet"
      title="Print a clipboard run-sheet for the tech onsite. For the customer-facing PDF, use Customer Report."
      onClick={() => download('standard')}
      options={[
        {
          label: 'Summary',
          description: 'Master register only — single page, supervisor hand-out',
          onSelect: () => download('summary'),
        },
        {
          label: 'Standard',
          description: 'Default. Master register page + per-asset detail cards. Supervisor keeps page 1, tech gets the rest.',
          onSelect: () => download('standard'),
          recommended: true,
        },
        {
          label: 'Detailed',
          description: 'Per-asset detail cards only (no master). For when supervisor already has the master.',
          onSelect: () => download('detailed'),
        },
      ]}
    />
  )
}
