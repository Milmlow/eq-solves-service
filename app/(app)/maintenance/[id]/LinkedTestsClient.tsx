'use client'

/**
 * Client-side filter + display layer for the Linked Tests panel.
 * The parent server component (LinkedTestsPanel) fetches all test data and
 * passes it here as plain serialisable props. Filtering and sorting happen
 * entirely in the browser so there are no extra round-trips.
 */

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Shield, CircuitBoard, ShieldCheck, ChevronRight, Search, X } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'

// ── Types (mirrored from LinkedTestsPanel — kept local so no barrel needed) ──

export interface AcbNsxTestItem {
  id: string
  kind: 'acb' | 'nsx'
  assetName: string
  serialNumber: string | null
  step1Status: string | null
  step2Status: string | null
  step3Status: string | null
  overallResult: string | null
  href: string
}

export interface RcdTestItem {
  id: string
  assetName: string
  jemenaAssetId: string | null
  status: string
  testDate: string
  href: string
}

type ResultFilter = 'all' | 'pass' | 'fail' | 'in_progress' | 'pending'
type StepFilter  = 'all' | 'complete' | 'in_progress' | 'not_started'

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepCount(item: Pick<AcbNsxTestItem, 'step1Status' | 'step2Status' | 'step3Status'>) {
  return (
    (item.step1Status === 'complete' ? 1 : 0) +
    (item.step2Status === 'complete' ? 1 : 0) +
    (item.step3Status === 'complete' ? 1 : 0)
  )
}

function deriveResult(item: AcbNsxTestItem): string {
  if (item.overallResult && item.overallResult !== 'Pending') return item.overallResult
  const done = stepCount(item)
  if (done === 3) return 'Complete'
  if (done > 0)  return 'In progress'
  return 'Pending'
}

function deriveStepState(item: AcbNsxTestItem): StepFilter {
  const done = stepCount(item)
  if (done === 3) return 'complete'
  if (done > 0)  return 'in_progress'
  return 'not_started'
}

function resultTone(display: string) {
  if (display === 'Pass' || display === 'Complete')
    return 'bg-green-50 text-green-700 border-green-200'
  if (display === 'Fail' || display === 'Defect')
    return 'bg-red-50 text-red-700 border-red-200'
  if (display === 'In progress')
    return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-gray-50 text-gray-600 border-gray-200'
}

function rcdStatusTone(status: string): 'active' | 'inactive' | 'in-progress' {
  if (status === 'complete') return 'active'
  if (status === 'archived' || status === 'cancelled') return 'inactive'
  return 'in-progress'
}

// ── Filter pill component ──────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-eq-sky text-white border-eq-sky'
          : 'bg-white text-eq-grey border-gray-200 hover:border-eq-sky hover:text-eq-deep'
      }`}
    >
      {label}
    </button>
  )
}

// ── Section sub-header ────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  shown,
  total,
}: {
  icon: React.ReactNode
  label: string
  shown: number
  total: number
}) {
  return (
    <div className="px-4 py-1.5 bg-gray-50 text-[11px] font-bold text-eq-grey uppercase tracking-wide flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      {shown < total && (
        <span className="normal-case font-normal tracking-normal">
          {shown} of {total}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  acb: AcbNsxTestItem[]
  nsx: AcbNsxTestItem[]
  rcd: RcdTestItem[]
}

export function LinkedTestsClient({ acb, nsx, rcd }: Props) {
  const [search, setSearch] = useState('')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [stepFilter, setStepFilter] = useState<StepFilter>('all')

  const isFiltered = search.trim() !== '' || resultFilter !== 'all' || stepFilter !== 'all'

  // Filter ACB/NSX items
  const filterAcbNsx = (items: AcbNsxTestItem[]) => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      // Name search
      if (q && !item.assetName.toLowerCase().includes(q) && !(item.serialNumber ?? '').toLowerCase().includes(q)) return false

      // Result filter
      if (resultFilter !== 'all') {
        const derived = deriveResult(item).toLowerCase().replace(' ', '_')
        const result = (item.overallResult ?? '').toLowerCase()
        if (resultFilter === 'pass'        && result !== 'pass')                     return false
        if (resultFilter === 'fail'        && result !== 'fail' && result !== 'defect') return false
        if (resultFilter === 'pending'     && derived !== 'pending')                 return false
        if (resultFilter === 'in_progress' && derived !== 'in_progress')             return false
      }

      // Step filter
      if (stepFilter !== 'all') {
        if (deriveStepState(item) !== stepFilter) return false
      }

      return true
    })
  }

  // Filter RCD items
  const filterRcd = (items: RcdTestItem[]) => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (q && !item.assetName.toLowerCase().includes(q) && !(item.jemenaAssetId ?? '').toLowerCase().includes(q)) return false
      if (resultFilter !== 'all') {
        if (resultFilter === 'pass'        && item.status !== 'complete')   return false
        if (resultFilter === 'in_progress' && item.status !== 'draft')      return false
        if (resultFilter === 'pending'     && item.status !== 'draft')      return false
        // 'fail' — RCD tests don't have a fail state so hide all when fail selected
        if (resultFilter === 'fail') return false
      }
      if (stepFilter !== 'all') {
        const s = item.status === 'complete' ? 'complete' : 'not_started'
        if (s !== stepFilter) return false
      }
      return true
    })
  }

  const filteredAcb = useMemo(() => filterAcbNsx(acb), [acb, search, resultFilter, stepFilter])  // eslint-disable-line react-hooks/exhaustive-deps
  const filteredNsx = useMemo(() => filterAcbNsx(nsx), [nsx, search, resultFilter, stepFilter])  // eslint-disable-line react-hooks/exhaustive-deps
  const filteredRcd = useMemo(() => filterRcd(rcd),     [rcd, search, resultFilter, stepFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  const total    = acb.length + nsx.length + rcd.length
  const shown    = filteredAcb.length + filteredNsx.length + filteredRcd.length
  const hasAcb   = acb.length > 0
  const hasNsx   = nsx.length > 0
  const hasRcd   = rcd.length > 0

  // Only show result filters relevant to the kinds present
  const showFailFilter = hasAcb || hasNsx  // RCD doesn't have pass/fail per test

  return (
    <div>
      {/* Filter bar — only when there are enough tests to be worth filtering */}
      {total > 3 && (
        <div className="px-4 pt-3 pb-2 space-y-2 border-b border-gray-100">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-eq-grey pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by asset name or serial…"
              className="w-full h-8 pl-8 pr-8 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:border-eq-sky focus:ring-1 focus:ring-eq-sky/20"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-eq-grey hover:text-eq-ink"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Result + step filters */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-eq-grey self-center pr-1">Result:</span>
            {(['all', 'pass', 'fail', 'in_progress', 'pending'] as ResultFilter[])
              .filter((f) => showFailFilter || f !== 'fail')
              .map((f) => (
                <FilterPill
                  key={f}
                  label={f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                  active={resultFilter === f}
                  onClick={() => setResultFilter(f)}
                />
              ))}
            <span className="text-[11px] text-eq-grey self-center pl-2 pr-1">Steps:</span>
            {(['all', 'complete', 'in_progress', 'not_started'] as StepFilter[]).map((f) => (
              <FilterPill
                key={f}
                label={f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f === 'not_started' ? 'Not Started' : 'Complete'}
                active={stepFilter === f}
                onClick={() => setStepFilter(f)}
              />
            ))}
            {isFiltered && (
              <button
                type="button"
                onClick={() => { setSearch(''); setResultFilter('all'); setStepFilter('all') }}
                className="text-[11px] text-eq-grey underline hover:text-eq-ink ml-auto"
              >
                Clear
              </button>
            )}
          </div>

          {/* Count feedback */}
          {isFiltered && (
            <p className="text-[11px] text-eq-grey">
              Showing {shown} of {total} test{total !== 1 ? 's' : ''}
              {shown === 0 && ' — no matches'}
            </p>
          )}
        </div>
      )}

      {/* ACB section */}
      {hasAcb && (
        <div className="border-b border-gray-100 last:border-b-0">
          <SectionHeader
            icon={<Shield className="w-3.5 h-3.5" />}
            label={`ACB Tests (${acb.length})`}
            shown={filteredAcb.length}
            total={acb.length}
          />
          <div className="divide-y divide-gray-100">
            {filteredAcb.length === 0 ? (
              <p className="px-4 py-3 text-xs text-eq-grey italic">No ACB tests match the current filter.</p>
            ) : (
              filteredAcb.map((item) => (
                <AcbNsxRow key={item.id} item={item} />
              ))
            )}
          </div>
        </div>
      )}

      {/* NSX section */}
      {hasNsx && (
        <div className="border-b border-gray-100 last:border-b-0">
          <SectionHeader
            icon={<CircuitBoard className="w-3.5 h-3.5" />}
            label={`NSX Tests (${nsx.length})`}
            shown={filteredNsx.length}
            total={nsx.length}
          />
          <div className="divide-y divide-gray-100">
            {filteredNsx.length === 0 ? (
              <p className="px-4 py-3 text-xs text-eq-grey italic">No NSX tests match the current filter.</p>
            ) : (
              filteredNsx.map((item) => (
                <AcbNsxRow key={item.id} item={item} />
              ))
            )}
          </div>
        </div>
      )}

      {/* RCD section */}
      {hasRcd && (
        <div className="border-b border-gray-100 last:border-b-0">
          <SectionHeader
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            label={`RCD Tests (${rcd.length})`}
            shown={filteredRcd.length}
            total={rcd.length}
          />
          <div className="divide-y divide-gray-100">
            {filteredRcd.length === 0 ? (
              <p className="px-4 py-3 text-xs text-eq-grey italic">No RCD tests match the current filter.</p>
            ) : (
              filteredRcd.map((item) => (
                <RcdRow key={item.id} item={item} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Row components ─────────────────────────────────────────────────────────────

function AcbNsxRow({ item }: { item: AcbNsxTestItem }) {
  const done    = stepCount(item)
  const display = deriveResult(item)

  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-eq-ice/40 transition-colors"
    >
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium text-eq-ink truncate">{item.assetName}</span>
        {item.serialNumber && (
          <span className="text-[11px] font-mono text-eq-grey mt-0.5">{item.serialNumber}</span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Step dots */}
        <span className="flex items-center gap-1" aria-label={`${done} of 3 steps complete`}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full ${i < done ? 'bg-eq-sky' : 'bg-gray-200'}`}
            />
          ))}
          <span className="ml-1 text-[11px] text-eq-grey tabular-nums">{done}/3</span>
        </span>

        {/* Result pill */}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${resultTone(display)}`}>
          {display}
        </span>

        <ChevronRight className="w-4 h-4 text-eq-grey" />
      </div>
    </Link>
  )
}

function RcdRow({ item }: { item: RcdTestItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-eq-ice/40 transition-colors"
    >
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium text-eq-ink truncate">{item.assetName}</span>
        {item.jemenaAssetId && (
          <span className="text-[11px] font-mono text-eq-grey mt-0.5">{item.jemenaAssetId}</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={rcdStatusTone(item.status)} />
        <ChevronRight className="w-4 h-4 text-eq-grey" />
      </div>
    </Link>
  )
}
