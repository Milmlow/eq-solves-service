'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Site } from '@/lib/types'
import { ReportDownloadDialog } from '@/components/ui/ReportDownloadDialog'
import type { ReportComplexity } from '@/components/ui/ReportDownloadDialog'

interface BulkExportButtonProps {
  sites: Pick<Site, 'id' | 'name'>[]
}

export function BulkExportButton({ sites }: BulkExportButtonProps) {
  const [siteId, setSiteId] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  async function handleExport(complexity: ReportComplexity) {
    if (!siteId) return
    const res = await fetch(`/api/bulk-report?site_id=${siteId}&complexity=${complexity}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Export failed' }))
      alert(err.error ?? 'Export failed')
      throw new Error(err.error)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'reports.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={siteId}
        onChange={(e) => setSiteId(e.target.value)}
        className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
      >
        <option value="">Site for bulk export</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <button
        onClick={() => setDialogOpen(true)}
        disabled={!siteId}
        className="flex items-center gap-1.5 h-9 px-3 text-sm font-medium text-white bg-eq-sky hover:bg-eq-deep disabled:opacity-50 rounded-md transition-colors"
      >
        <Download className="w-4 h-4" />
        Export ZIP
      </button>

      <ReportDownloadDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDownload={handleExport}
        title="Bulk Test Reports"
      />
    </div>
  )
}
