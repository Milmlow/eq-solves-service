'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AppError]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-eq-ink">Something went wrong</h2>
        <p className="text-sm text-eq-grey max-w-sm">
          An unexpected error occurred. Refreshing the page usually fixes this.
          {error.digest && (
            <span className="block mt-1 text-xs text-gray-400">Ref: {error.digest}</span>
          )}
        </p>
      </div>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </div>
  )
}
