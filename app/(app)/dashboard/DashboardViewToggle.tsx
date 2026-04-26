'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type View = 'mine' | 'all'

/**
 * Dashboard scope toggle.
 *
 * Two states:
 *   - 'all'  → "All Active Work" — every open check / WO / defect across the tenant.
 *   - 'mine' → "Assigned to Me" — only items where assignee_user_id === current user.
 *
 * Persists via the `view` query param so the choice survives page refreshes
 * and is shareable via URL. Default landing scope is decided server-side
 * (page.tsx) based on whether the user has any assigned items.
 */
export function DashboardViewToggle({ currentView }: { currentView: View }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const toggle = useCallback(() => {
    const next: View = currentView === 'mine' ? 'all' : 'mine'
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', next)
    router.push(`/dashboard?${params.toString()}`)
  }, [currentView, router, searchParams])

  const label = currentView === 'mine' ? 'Assigned to Me' : 'All Active Work'
  const dotClass = currentView === 'mine' ? 'bg-eq-sky' : 'bg-green-500'

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-eq-ink shrink-0"
      title={`Currently showing ${label}. Click to switch.`}
    >
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      {label}
      <span className="text-xs text-eq-grey ml-1">Switch →</span>
    </button>
  )
}
