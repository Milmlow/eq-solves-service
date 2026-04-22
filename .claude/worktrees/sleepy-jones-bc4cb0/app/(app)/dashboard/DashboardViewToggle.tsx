'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type View = 'mine' | 'all'

export function DashboardViewToggle({ currentView }: { currentView: View }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const toggle = useCallback(() => {
    const next: View = currentView === 'mine' ? 'all' : 'mine'
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', next)
    router.push(`/dashboard?${params.toString()}`)
  }, [currentView, router, searchParams])

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm font-medium text-eq-ink shrink-0"
    >
      <span className={`w-2 h-2 rounded-full ${currentView === 'mine' ? 'bg-eq-sky' : 'bg-green-500'}`} />
      {currentView === 'mine' ? 'My Work' : 'All Work'}
      <span className="text-xs text-eq-grey ml-1">Switch →</span>
    </button>
  )
}
