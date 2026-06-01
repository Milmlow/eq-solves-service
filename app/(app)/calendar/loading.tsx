import { Skeleton, SkeletonCards } from '@/components/ui/Skeleton'

export default function CalendarLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading calendar">
      <div>
        <Skeleton shape="line" className="w-40 h-4" />
        <Skeleton shape="line" className="w-48 h-8 mt-3" />
        <Skeleton shape="line" className="w-2/3 h-4 mt-2" />
      </div>

      {/* Status strip KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-4 h-[88px] overflow-hidden">
            <Skeleton shape="line" className="w-20 h-3" />
            <Skeleton shape="line" className="w-12 h-8 mt-3" />
            <Skeleton shape="line" className="w-28 h-3 mt-2" />
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton shape="line" className="h-9 w-64" />
        <Skeleton shape="line" className="h-9 w-44" />
        <div className="ml-auto flex gap-2">
          <Skeleton shape="line" className="h-8 w-28" />
          <Skeleton shape="line" className="h-8 w-24" />
          <Skeleton shape="line" className="h-8 w-24" />
        </div>
      </div>

      {/* Month grid */}
      <div className="border border-gray-100 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50/60 border-b border-gray-100">
          <div className="flex gap-2">
            <Skeleton shape="line" className="w-7 h-7 rounded-md" />
            <Skeleton shape="line" className="w-7 h-7 rounded-md" />
          </div>
          <Skeleton shape="line" className="w-36 h-5" />
          <Skeleton shape="line" className="w-16 h-4" />
        </div>
        {/* Day-of-week row */}
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-2 py-1.5 flex justify-center">
              <Skeleton shape="line" className="w-8 h-3" />
            </div>
          ))}
        </div>
        {/* Grid cells — 6 rows × 7 columns */}
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }).map((_, i) => (
            <div
              key={i}
              className={`min-h-[96px] p-1.5 border-gray-100 ${i % 7 !== 6 ? 'border-r' : ''} ${i < 35 ? 'border-b' : ''}`}
            >
              <Skeleton shape="line" className="w-5 h-4 mb-1" />
              {/* Show skeleton event chips in some cells */}
              {i % 3 === 0 && <Skeleton shape="line" className="w-full h-4 rounded mb-1" />}
              {i % 5 === 0 && <Skeleton shape="line" className="w-4/5 h-4 rounded" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
