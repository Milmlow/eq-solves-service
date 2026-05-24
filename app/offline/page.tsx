export const dynamic = 'force-static'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-eq-ice rounded-full flex items-center justify-center mx-auto mb-5">
          <svg
            className="w-8 h-8 text-eq-sky"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3l18 18M8.288 8.33A5.234 5.234 0 006 12.5a5.25 5.25 0 005.25 5.25c1.487 0 2.83-.62 3.794-1.614M10.5 6.025A7.5 7.5 0 0119.5 12.5a7.484 7.484 0 01-1.37 4.352M2.25 12.5A9.75 9.75 0 0112 3c1.04 0 2.044.162 2.988.464"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-eq-ink mb-2">You&apos;re offline</h1>
        <p className="text-sm text-gray-500 mb-6">
          No network connection. Checks you&apos;ve already opened on this device are
          still readable — go back and navigate to one.
        </p>
        <a
          href="/maintenance"
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-eq-sky hover:bg-eq-deep rounded-lg transition-colors"
        >
          Back to maintenance
        </a>
      </div>
    </div>
  )
}
