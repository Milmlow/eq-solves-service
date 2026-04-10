'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { PmCalendarForm } from './PmCalendarForm'
import { PmCalendarDetail } from './PmCalendarDetail'
import { seedPmCalendarAction } from './actions'
import { CalendarDays, List, LayoutGrid, Loader2 } from 'lucide-react'
import type { PmCalendarEntry, Site, PmCalendarCategory, AuFyQuarter } from '@/lib/types'

type EntryRow = PmCalendarEntry & { site_name: string } & Record<string, unknown>

interface PmCalendarViewProps {
  entries: EntryRow[]
  sites: Pick<Site, 'id' | 'name' | 'code' | 'address'>[]
  categories: string[]
  financialYears: string[]
  technicians: { id: string; email: string; full_name: string | null }[]
  page: number
  totalPages: number
  viewMode: 'list' | 'calendar' | 'quarterly'
  isAdmin: boolean
  canWrite: boolean
}

// Category colour mapping
const categoryColours: Record<string, string> = {
  'Thermal scanning': 'bg-red-100 text-red-700',
  'Dark site test': 'bg-purple-100 text-purple-700',
  'Emergency lighting': 'bg-amber-100 text-amber-700',
  'Lightning protection testing': 'bg-yellow-100 text-yellow-700',
  'Management': 'bg-gray-100 text-gray-600',
  'RCD testing': 'bg-blue-100 text-blue-700',
  'Test and tagging': 'bg-teal-100 text-teal-700',
  'Quarterly maintenance': 'bg-green-100 text-green-700',
  'WOs': 'bg-orange-100 text-orange-700',
}

function CategoryBadge({ category }: { category: string }) {
  const cls = categoryColours[category] ?? 'bg-gray-100 text-gray-600'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{category}</span>
}

function statusToBadge(status: string): 'active' | 'not-started' | 'complete' | 'inactive' {
  const map: Record<string, 'active' | 'not-started' | 'complete' | 'inactive'> = {
    scheduled: 'not-started',
    in_progress: 'active',
    completed: 'complete',
    cancelled: 'inactive',
  }
  return map[status] ?? 'not-started'
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCurrency(amount: number) {
  return amount === 0 ? '—' : `$${amount.toLocaleString('en-AU', { minimumFractionDigits: 0 })}`
}

const QUARTER_LABELS: Record<AuFyQuarter, string> = {
  Q1: 'Q1 (Jul–Sep)',
  Q2: 'Q2 (Oct–Dec)',
  Q3: 'Q3 (Jan–Mar)',
  Q4: 'Q4 (Apr–Jun)',
}

const MONTH_NAMES = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

export function PmCalendarView({
  entries, sites, categories, financialYears, technicians,
  page, totalPages, viewMode, isAdmin, canWrite: canWriteRole,
}: PmCalendarViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [createOpen, setCreateOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<EntryRow | null>(null)
  const [detailEntry, setDetailEntry] = useState<EntryRow | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  // View toggle
  function setView(v: 'list' | 'calendar' | 'quarterly') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', v)
    params.delete('page')
    router.push(`/pm-calendar?${params.toString()}`)
  }

  // Seed data handler
  async function handleSeed() {
    if (!confirm('This will seed ~100 PM calendar entries for the 2025-2026 FY. Continue?')) return
    setSeeding(true)
    setSeedMsg(null)
    const result = await seedPmCalendarAction()
    setSeeding(false)
    if (result.success) {
      setSeedMsg((result as { success: true; message: string }).message ?? 'Seeded successfully')
      router.refresh()
    } else {
      setSeedMsg(`Error: ${result.error}`)
    }
  }

  // ===== QUARTERLY SUMMARY =====
  const quarterlySummary = useMemo(() => {
    const summary: Record<string, Record<string, { hours: number; cost: number; count: number }>> = {}
    for (const e of entries) {
      const q = e.quarter ?? 'Unknown'
      const site = e.site_name
      if (!summary[q]) summary[q] = {}
      if (!summary[q][site]) summary[q][site] = { hours: 0, cost: 0, count: 0 }
      summary[q][site].hours += Number(e.hours) || 0
      summary[q][site].cost += Number(e.contractor_materials_cost) || 0
      summary[q][site].count += 1
    }
    return summary
  }, [entries])

  // ===== CALENDAR VIEW DATA =====
  const calendarData = useMemo(() => {
    // Group entries by month (AU FY: Jul=0, Aug=1, ..., Jun=11)
    const months: Record<number, EntryRow[]> = {}
    for (let i = 0; i < 12; i++) months[i] = []

    for (const e of entries) {
      const d = new Date(e.start_time)
      const m = d.getMonth()
      // Map calendar month to FY month index: Jul(6)=0, Aug(7)=1, ..., Jun(5)=11
      const fyMonthIndex = m >= 6 ? m - 6 : m + 6
      if (months[fyMonthIndex]) months[fyMonthIndex].push(e)
    }
    return months
  }, [entries])

  // Filter options
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name }))
  const categoryOptions = categories.map((c) => ({ value: c, label: c }))
  const quarterOptions = [
    { value: 'Q1', label: 'Q1 (Jul–Sep)' },
    { value: 'Q2', label: 'Q2 (Oct–Dec)' },
    { value: 'Q3', label: 'Q3 (Jan–Mar)' },
    { value: 'Q4', label: 'Q4 (Apr–Jun)' },
  ]
  const fyOptions = financialYears.map((fy) => ({ value: fy, label: `FY ${fy}` }))
  const statusOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  // ===== TABLE COLUMNS =====
  const columns: DataTableColumn<EntryRow>[] = [
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => <span className="font-medium text-eq-ink text-xs">{row.site_name}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => <span className="font-medium text-eq-ink">{row.title}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => <CategoryBadge category={row.category} />,
    },
    {
      key: 'start_time',
      header: 'Start',
      render: (row) => <span className="text-xs">{formatDate(row.start_time)}</span>,
    },
    {
      key: 'hours',
      header: 'Hours',
      render: (row) => <span className="text-xs tabular-nums">{Number(row.hours) || 0}</span>,
    },
    {
      key: 'contractor_materials_cost',
      header: 'Cost',
      render: (row) => <span className="text-xs tabular-nums">{formatCurrency(Number(row.contractor_materials_cost) || 0)}</span>,
    },
    {
      key: 'quarter',
      header: 'Quarter',
      render: (row) => <span className="text-xs">{row.quarter ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={statusToBadge(row.status)} label={row.status.replace('_', ' ')} />,
    },
  ]

  // ===== TOTALS =====
  const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0)
  const totalCost = entries.reduce((s, e) => s + (Number(e.contractor_materials_cost) || 0), 0)

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SearchFilter
            placeholder="Search entries..."
            filters={[
              { key: 'site', label: 'All Sites', options: siteOptions },
              { key: 'category', label: 'All Categories', options: categoryOptions },
              { key: 'quarter', label: 'All Quarters', options: quarterOptions },
              { key: 'fy', label: 'All FYs', options: fyOptions },
              { key: 'status', label: 'All Statuses', options: statusOptions },
            ]}
          />
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {/* View toggle */}
            <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
              <button
                onClick={() => setView('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-eq-sky text-white' : 'text-eq-grey hover:bg-gray-50'}`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('calendar')}
                className={`p-2 ${viewMode === 'calendar' ? 'bg-eq-sky text-white' : 'text-eq-grey hover:bg-gray-50'}`}
                title="Calendar view"
              >
                <CalendarDays className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('quarterly')}
                className={`p-2 ${viewMode === 'quarterly' ? 'bg-eq-sky text-white' : 'text-eq-grey hover:bg-gray-50'}`}
                title="Quarterly summary"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            {isAdmin && entries.length === 0 && (
              <Button variant="secondary" size="sm" onClick={handleSeed} disabled={seeding}>
                {seeding ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Seeding...</> : 'Seed Data'}
              </Button>
            )}
            {canWriteRole && (
              <Button onClick={() => setCreateOpen(true)}>Add Entry</Button>
            )}
          </div>
        </div>
        {seedMsg && <p className={`text-sm ${seedMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{seedMsg}</p>}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-6 px-4 py-3 bg-white border border-gray-200 rounded-lg">
        <div className="text-sm"><span className="text-eq-grey">Entries:</span> <span className="font-semibold text-eq-ink">{entries.length}</span></div>
        <div className="text-sm"><span className="text-eq-grey">Total Hours:</span> <span className="font-semibold text-eq-ink">{totalHours.toLocaleString()}</span></div>
        <div className="text-sm"><span className="text-eq-grey">Total Cost:</span> <span className="font-semibold text-eq-ink">${totalCost.toLocaleString('en-AU')}</span></div>
      </div>

      {/* ===== LIST VIEW ===== */}
      {viewMode === 'list' && (
        entries.length === 0 ? (
          <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
            <p className="text-eq-grey text-sm mb-3">No PM calendar entries yet.</p>
            {canWriteRole && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>Add your first entry</Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={entries}
              emptyMessage="No entries match your filters."
              onRowClick={(row) => setDetailEntry(row)}
            />
            <Pagination page={page} totalPages={totalPages} />
          </>
        )
      )}

      {/* ===== CALENDAR VIEW ===== */}
      {viewMode === 'calendar' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {MONTH_NAMES.map((monthName, idx) => {
            const monthEntries = calendarData[idx] ?? []
            return (
              <div key={monthName} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="px-4 py-2 bg-eq-sky/5 border-b border-gray-100">
                  <h3 className="font-semibold text-eq-ink text-sm">{monthName}</h3>
                  <span className="text-xs text-eq-grey">{monthEntries.length} tasks</span>
                </div>
                <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                  {monthEntries.length === 0 ? (
                    <p className="text-xs text-eq-grey italic">No tasks scheduled</p>
                  ) : (
                    monthEntries.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setDetailEntry(e)}
                        className="w-full text-left p-2 rounded-md hover:bg-gray-50 border border-gray-100 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-eq-ink truncate">{e.title}</span>
                          <span className="text-[10px] text-eq-grey shrink-0">{e.site_name.split(' — ')[0]}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <CategoryBadge category={e.category} />
                          {Number(e.hours) > 0 && <span className="text-[10px] text-eq-grey">{e.hours}h</span>}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== QUARTERLY VIEW ===== */}
      {viewMode === 'quarterly' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['Q1', 'Q2', 'Q3', 'Q4'] as AuFyQuarter[]).map((q) => {
            const siteSummaries = quarterlySummary[q] ?? {}
            const siteKeys = Object.keys(siteSummaries).sort()
            const qHours = siteKeys.reduce((s, k) => s + siteSummaries[k].hours, 0)
            const qCost = siteKeys.reduce((s, k) => s + siteSummaries[k].cost, 0)
            const qCount = siteKeys.reduce((s, k) => s + siteSummaries[k].count, 0)

            return (
              <div key={q} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="px-4 py-3 bg-eq-sky/5 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-eq-ink">{QUARTER_LABELS[q]}</h3>
                  <div className="flex items-center gap-4 text-xs text-eq-grey">
                    <span>{qCount} tasks</span>
                    <span>{qHours}h</span>
                    <span className="font-semibold text-eq-ink">{formatCurrency(qCost)}</span>
                  </div>
                </div>
                <div className="p-4">
                  {siteKeys.length === 0 ? (
                    <p className="text-sm text-eq-grey italic">No entries</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-eq-grey border-b border-gray-100">
                          <th className="pb-2">Site</th>
                          <th className="pb-2 text-right">Tasks</th>
                          <th className="pb-2 text-right">Hours</th>
                          <th className="pb-2 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteKeys.map((site) => (
                          <tr key={site} className="border-b border-gray-50">
                            <td className="py-1.5 font-medium text-eq-ink text-xs">{site}</td>
                            <td className="py-1.5 text-right tabular-nums text-xs">{siteSummaries[site].count}</td>
                            <td className="py-1.5 text-right tabular-nums text-xs">{siteSummaries[site].hours}</td>
                            <td className="py-1.5 text-right tabular-nums text-xs">{formatCurrency(siteSummaries[site].cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-eq-ink">
                          <td className="pt-2 text-xs">Total</td>
                          <td className="pt-2 text-right tabular-nums text-xs">{qCount}</td>
                          <td className="pt-2 text-right tabular-nums text-xs">{qHours}</td>
                          <td className="pt-2 text-right tabular-nums text-xs">{formatCurrency(qCost)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Form */}
      <PmCalendarForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        sites={sites}
        categories={categories}
        technicians={technicians}
      />

      {editEntry && (
        <PmCalendarForm
          open={!!editEntry}
          onClose={() => setEditEntry(null)}
          entry={editEntry}
          sites={sites}
          categories={categories}
          technicians={technicians}
        />
      )}

      {/* Detail View */}
      {detailEntry && (
        <PmCalendarDetail
          open={!!detailEntry}
          onClose={() => setDetailEntry(null)}
          entry={detailEntry}
          isAdmin={isAdmin}
          canWrite={canWriteRole}
          onEdit={() => { setEditEntry(detailEntry); setDetailEntry(null) }}
        />
      )}
    </>
  )
}
