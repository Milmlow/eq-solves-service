'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Site } from '@/lib/types'

interface BulkExportButtonProps {
  sites: Pick<Site, 'id' | 'name'>[]
}

export function BulkExportButton({ sites }: BulkExportButtonProps) {
  const [siteId, setSiteId] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/bulk-report?site_id=${siteId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }))
        alert(err.error ?? 'Export failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'reports.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed')
    } finally {
      setLoading(false)
    }
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
        onClick={handleExport}
        disabled={!siteId || loading}
        className="flex items-center gap-1.5 h-9 px-3 text-sm font-medium text-white bg-eq-sky hover:bg-eq-deep disabled:opacity-50 rounded-md transition-colors"
      >
        <Download className="w-4 h-4" />
        {loading ? 'Generating...' : 'Export ZIP'}
      </button>
    </div>
  )
}
