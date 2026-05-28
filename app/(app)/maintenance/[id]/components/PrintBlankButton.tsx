'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'

/**
 * Single-action button that downloads the Field Run-Sheet in standard format
 * — explicitly labelled "Print Blank for Onsite" so techs know this is the
 * empty-form-for-handwriting use case. Calls the same `/api/maintenance-
 * checklist` endpoint as the SplitButton's standard option, just with a
 * clearer entry point. Royce 2026-04-28: "sometimes we print empty and
 * the guys complete on site".
 *
 * Uses fetch + blob download instead of window.open() so it works inside
 * the Shell iframe (allow-popups not set on the sandbox).
 *
 * Survives a check.kind discriminator: the route synthesizes
 * ChecklistAsset entries from linked acb/nsx/rcd_tests when no
 * check_assets exist, so this works for test-bench checks too.
 */
export function PrintBlankButton({ checkId }: { checkId: string }) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/maintenance-checklist?check_id=${checkId}&format=standard`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const match = disposition?.match(/filename="(.+?)"/)
      a.download = match?.[1] ?? 'Field Run-Sheet.docx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title="Print an empty run-sheet for the technician to complete onsite by hand. Same as Field Run-Sheet > Standard."
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white text-eq-ink rounded hover:border-eq-deep hover:text-eq-deep transition-colors disabled:opacity-50"
    >
      <Printer className="w-4 h-4" /> {loading ? 'Preparing…' : 'Print Blank for Onsite'}
    </button>
  )
}
