// E1 — loading.tsx for /maintenance/[id] (quality-polish-backlog E1).
// The check detail page fetches the check + assets + items + attachments
// in parallel — a meaningful SSR delay on slow connections. This replaces
// the blank white flash with an inline skeleton that mirrors the page's
// main structure: a header card + a content area below.
export default function CheckDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Breadcrumb + title */}
      <div>
        <div className="h-4 w-48 bg-gray-200 rounded" />
        <div className="h-8 w-72 bg-gray-300 rounded mt-3" />
        <div className="h-4 w-40 bg-gray-200 rounded mt-2" />
      </div>
      {/* Header card */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-6 w-24 bg-gray-200 rounded-full" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i}>
              <div className="h-3 w-16 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-300 rounded mt-2" />
            </div>
          ))}
        </div>
      </div>
      {/* Content skeleton */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <div className="h-4 w-28 bg-gray-300 rounded" />
        </div>
        <div className="divide-y divide-gray-100">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="h-4 w-1/4 bg-gray-200 rounded" />
              <div className="h-4 w-1/3 bg-gray-200 rounded" />
              <div className="h-4 w-1/6 bg-gray-200 rounded ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
