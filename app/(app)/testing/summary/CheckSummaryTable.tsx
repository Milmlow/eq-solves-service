'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/format'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export type CheckRow = {
  id: string
  name: string
  check_type: 'acb' | 'nsx' | 'general'
  site_name: string
  frequency: string | null
  month: number | null
  year: number | null
  status: string
  created_at: string
  total_assets: number
  completed_assets: number
  in_progress_assets: number
  assets: AssetRow[]
}

export type AssetRow = {
  id: string
  test_id: string
  asset_name: string
  asset_type: string
  serial_number: string | null
  progress: number
  status: string
  detail_href: string
}

function statusChip(status: string) {
  const map: Record<string, string> = {
    complete: 'bg-green-50 text-green-700',
    'in-progress': 'bg-eq-ice text-eq-deep',
    'in_progress': 'bg-eq-ice text-eq-deep',
    scheduled: 'bg-gray-100 text-gray-600',
    'not-started': 'bg-gray-100 text-gray-600',
    pass: 'bg-green-50 text-green-700',
    fail: 'bg-red-50 text-red-600',
    pending: 'bg-gray-100 text-gray-600',
    defect: 'bg-amber-50 text-amber-700',
    cancelled: 'bg-red-50 text-red-400',
  }
  const cls = map[status] ?? 'bg-gray-100 text-gray-600'
  const label = status.replace(/_/g, ' ').replace(/-/g, ' ')
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${cls}`}>
      {label}
    </span>
  )
}

function typeTag(type: string) {
  return (
    <span className="px-2 py-0.5 text-xs font-semibold rounded bg-eq-ice text-eq-deep uppercase">
      {type}
    </span>
  )
}

export function CheckSummaryTable({ checks }: { checks: CheckRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (checks.length === 0) {
    return (
      <Card className="p-8 text-center text-eq-grey text-sm">
        No testing checks found. Create a check from the ACB or NSX testing page.
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 w-8" />
              <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Check</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Type</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Site</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Created</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Progress</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {checks.map((check) => {
              const isExpanded = expanded.has(check.id)
              const progressPct = check.total_assets > 0
                ? Math.round((check.completed_assets / check.total_assets) * 100)
                : 0

              return (
                <>
                  <tr
                    key={check.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleExpand(check.id)}
                  >
                    <td className="px-4 py-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-eq-grey" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-eq-grey" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-eq-ink">{check.name}</p>
                      <p className="text-xs text-eq-grey mt-0.5">
                        {check.completed_assets}/{check.total_assets} assets complete
                      </p>
                    </td>
                    <td className="px-4 py-3">{typeTag(check.check_type)}</td>
                    <td className="px-4 py-3 text-eq-grey">{check.site_name}</td>
                    <td className="px-4 py-3 text-eq-grey text-xs">{formatDate(check.created_at)}</td>
                    <td className="px-4 py-3 w-40">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${progressPct === 100 ? 'bg-green-500' : progressPct > 0 ? 'bg-eq-sky' : 'bg-gray-200'}`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-eq-grey w-10 text-right">{progressPct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusChip(check.status)}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${check.id}-detail`}>
                      <td colSpan={7} className="bg-gray-50 px-4 py-0">
                        <div className="py-3 pl-8">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-200">
                                <th className="text-left py-1.5 px-3 text-xs font-bold text-eq-grey uppercase">Asset</th>
                                <th className="text-left py-1.5 px-3 text-xs font-bold text-eq-grey uppercase">Type</th>
                                <th className="text-left py-1.5 px-3 text-xs font-bold text-eq-grey uppercase">Serial</th>
                                <th className="text-left py-1.5 px-3 text-xs font-bold text-eq-grey uppercase">Progress</th>
                                <th className="text-left py-1.5 px-3 text-xs font-bold text-eq-grey uppercase">Status</th>
                                <th className="text-right py-1.5 px-3 text-xs font-bold text-eq-grey uppercase">Open</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {check.assets.map((asset) => (
                                <tr key={asset.id} className="hover:bg-white">
                                  <td className="py-1.5 px-3 font-medium text-eq-ink">{asset.asset_name}</td>
                                  <td className="py-1.5 px-3 text-eq-grey text-xs">{asset.asset_type}</td>
                                  <td className="py-1.5 px-3 text-eq-grey text-xs">{asset.serial_number || '-'}</td>
                                  <td className="py-1.5 px-3 w-32">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${asset.progress === 100 ? 'bg-green-500' : asset.progress > 0 ? 'bg-eq-sky' : 'bg-gray-200'}`}
                                          style={{ width: `${asset.progress}%` }}
                                        />
                                      </div>
                                      <span className="text-xs text-eq-grey w-8 text-right">{asset.progress}%</span>
                                    </div>
                                  </td>
                                  <td className="py-1.5 px-3">{statusChip(asset.status)}</td>
                                  <td className="py-1.5 px-3 text-right">
                                    <Link href={asset.detail_href} className="text-eq-sky hover:text-eq-deep text-xs font-medium">
                                      Open
                                    </Link>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
