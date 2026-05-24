export default function CheckDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Back link + header */}
      <div className="space-y-3">
        <div className="h-4 w-24 bg-gray-200 rounded" />
        <div className="h-8 w-64 bg-gray-200 rounded" />
        <div className="flex gap-2 items-center">
          <div className="h-5 w-20 bg-gray-200 rounded-full" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex gap-2">
        <div className="h-9 w-28 bg-gray-200 rounded-lg" />
        <div className="h-9 w-28 bg-gray-200 rounded-lg" />
        <div className="h-9 w-28 bg-gray-200 rounded-lg" />
      </div>

      {/* Asset table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Table header */}
        <div className="border-b border-gray-100 px-4 py-3 flex gap-4">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-4 w-20 bg-gray-200 rounded ml-auto" />
        </div>
        {/* Rows */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-t border-gray-100 px-4 py-3 flex gap-4 items-center">
            <div className="h-4 w-40 bg-gray-100 rounded" />
            <div className="h-4 w-24 bg-gray-100 rounded" />
            <div className="h-4 w-28 bg-gray-100 rounded" />
            <div className="h-6 w-16 bg-gray-100 rounded-full ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
