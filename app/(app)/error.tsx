'use client'

// E1 — app-segment error boundary (quality-polish-backlog E1).
// Catches errors thrown in any RSC within the (app) route group and
// renders a recovery screen instead of the raw Next.js error page.
// reset() re-renders the segment; falling back to the dashboard is
// always safe since that's a full server render.

import { useEffect } from 'react'
import Link from 'next/link'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AppError({ error, reset }: Props) {
  useEffect(() => {
    // Surface to Sentry via the existing instrumentation — the Sentry SDK
    // captures unhandled RSC errors automatically via the Next.js integration,
    // but logging here ensures client-boundary errors are also captured.
    console.error('[app-error-boundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto">
          <svg
            className="w-6 h-6 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-eq-ink">Something went wrong</h1>
        <p className="text-sm text-eq-grey">
          An error occurred loading this page. If it keeps happening,{' '}
          contact your administrator.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-gray-400">
            Ref: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={reset}
            className="h-9 px-4 text-sm font-semibold rounded-md bg-eq-sky text-white hover:bg-eq-deep transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="h-9 px-4 text-sm font-semibold rounded-md border border-gray-200 text-eq-ink hover:bg-gray-50 transition-colors inline-flex items-center"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
