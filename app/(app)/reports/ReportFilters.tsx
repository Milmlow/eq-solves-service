'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import type { Site } from '@/lib/types'

interface ReportFiltersProps {
  sites: Pick<Site, 'id' | 'name'>[]
}

export function ReportFilters({ sites }: ReportFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const siteId = searchParams.get('site_id') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const updateParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`/reports?${params.toString()}`)
  }, [router, searchParams])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={siteId}
        onChange={(e) => updateParam('site_id', e.target.value)}
        className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
      >
        <option value="">All Sites</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <div className="flex items-center gap-2 text-xs text-eq-grey">
        <span>From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => updateParam('from', e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
        />
        <span>To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => updateParam('to', e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
        />
      </div>
      {(siteId || from || to) && (
        <button
          onClick={() => router.push('/reports')}
          className="text-xs text-eq-sky hover:text-eq-deep transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
