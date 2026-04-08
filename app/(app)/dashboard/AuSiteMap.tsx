'use client'

import { useState } from 'react'

interface StateData {
  count: number
  sites: string[]
}

interface AuSiteMapProps {
  stateData: Record<string, StateData>
}

// Approximate centre positions for AU states (percentage-based for responsive)
const STATE_POSITIONS: Record<string, { x: number; y: number; label: string }> = {
  NSW: { x: 78, y: 58, label: 'NSW' },
  VIC: { x: 72, y: 72, label: 'VIC' },
  QLD: { x: 76, y: 32, label: 'QLD' },
  SA: { x: 55, y: 55, label: 'SA' },
  WA: { x: 25, y: 45, label: 'WA' },
  TAS: { x: 74, y: 87, label: 'TAS' },
  NT: { x: 48, y: 25, label: 'NT' },
  ACT: { x: 82, y: 62, label: 'ACT' },
}

export function AuSiteMap({ stateData }: AuSiteMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)

  const totalSites = Object.values(stateData).reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="flex gap-6 items-start">
      {/* Map area */}
      <div className="relative w-full max-w-md aspect-[4/3] bg-gradient-to-b from-sky-50 to-blue-50 rounded-xl overflow-hidden">
        {/* Australia outline - simplified SVG */}
        <svg viewBox="0 0 200 150" className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M30,35 C35,28 55,20 70,18 C80,17 90,22 100,18 C110,14 120,16 130,20 C140,24 148,22 155,28 C162,34 168,30 170,38 C172,46 170,55 168,62 C166,68 168,75 165,82 C162,88 158,92 155,98 C150,105 145,110 138,112 C130,114 120,110 112,112 C105,114 98,118 90,115 C82,112 75,108 68,105 C60,102 52,100 45,95 C38,90 32,82 28,74 C24,66 22,55 25,45 C27,40 28,38 30,35Z"
            fill="#E0F2FE"
            stroke="#93C5FD"
            strokeWidth="0.8"
          />
          {/* Tasmania */}
          <path
            d="M142,125 C146,122 152,122 154,126 C156,130 152,134 148,134 C144,134 140,130 142,125Z"
            fill="#E0F2FE"
            stroke="#93C5FD"
            strokeWidth="0.8"
          />
        </svg>

        {/* State pins */}
        {Object.entries(STATE_POSITIONS).map(([state, pos]) => {
          const data = stateData[state]
          if (!data || data.count === 0) return null

          const isHovered = hoveredState === state
          const size = Math.min(12 + data.count * 3, 28)

          return (
            <div
              key={state}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-200"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              onMouseEnter={() => setHoveredState(state)}
              onMouseLeave={() => setHoveredState(null)}
            >
              <div
                className={`rounded-full flex items-center justify-center font-bold text-white shadow-md transition-all duration-200 ${isHovered ? 'bg-eq-deep scale-125 ring-4 ring-eq-sky/30' : 'bg-eq-sky'}`}
                style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
              >
                {data.count}
              </div>
              <p className={`absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] font-bold whitespace-nowrap transition-colors ${isHovered ? 'text-eq-deep' : 'text-eq-grey'}`}>
                {pos.label}
              </p>

              {/* Tooltip */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[140px] z-10">
                  <p className="text-xs font-bold text-eq-ink mb-1">{pos.label} — {data.count} {data.count === 1 ? 'site' : 'sites'}</p>
                  <div className="space-y-0.5">
                    {data.sites.slice(0, 5).map(name => (
                      <p key={name} className="text-[10px] text-eq-grey truncate">{name}</p>
                    ))}
                    {data.sites.length > 5 && (
                      <p className="text-[10px] text-eq-sky">+{data.sites.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* State legend / summary */}
      <div className="flex-1 min-w-[180px]">
        <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-3">
          {totalSites} {totalSites === 1 ? 'Site' : 'Sites'} Active
        </p>
        <div className="space-y-2">
          {Object.entries(stateData)
            .sort(([, a], [, b]) => b.count - a.count)
            .map(([state, data]) => (
              <div
                key={state}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors cursor-default"
                onMouseEnter={() => setHoveredState(state)}
                onMouseLeave={() => setHoveredState(null)}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${hoveredState === state ? 'bg-eq-deep' : 'bg-eq-sky'}`} />
                  <span className="text-sm text-eq-ink font-medium">{STATE_POSITIONS[state]?.label ?? state}</span>
                </div>
                <span className="text-sm font-bold text-eq-ink">{data.count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
