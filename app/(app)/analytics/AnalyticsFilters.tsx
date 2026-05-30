'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'

/**
 * S-W2-2 — customer + date-range filter for the Analytics page. Writes
 * customer_id / from / to URL params (server-side re-query), matching the
 * SearchFilter URL-param convention used elsewhere. Date inputs apply on
 * change; the customer select applies immediately.
 */
interface AnalyticsFiltersProps {
  customers: { value: string; label: string }[]
}

export function AnalyticsFilters({ customers }: AnalyticsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const update = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`)
    })
  }, [router, pathname, searchParams, startTransition])

  const customerId = searchParams.get('customer_id') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''
  const hasFilters = customerId || from || to

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-[11px] font-bold text-eq-grey uppercase tracking-wide mb-1">Customer</label>
        <select
          value={customerId}
          onChange={(e) => update('customer_id', e.target.value)}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        >
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-bold text-eq-grey uppercase tracking-wide mb-1">From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => update('from', e.target.value)}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold text-eq-grey uppercase tracking-wide mb-1">To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => update('to', e.target.value)}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        />
      </div>
      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push(pathname))}
          className="h-10 px-3 text-sm font-medium text-eq-grey hover:text-eq-ink transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  )
}
