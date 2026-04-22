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
import { seedPmCalendarAction, togglePmCalendarActiveAction, importPmCalendarCsvAction } from './actions'
import { CalendarDays, List, LayoutGrid, Loader2, Archive, Upload } from 'lucide-react'
import { CsvExportButton } from '@/components/ui/CsvExportButton'
import { parseCsv } from '@/lib/utils/csv'
import type { PmCalendarEntry, Site, PmCalendarCategory, AuFyQuarter } from '@/lib/types'
import { formatSiteLabel } from '@/lib/utils/format'

type SiteOption = Pick<Site, 'id' | 'name' | 'code' | 'address'> & {
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

type EntryRow = PmCalendarEntry & { site_name: string } & Record<string, unknown>

interface PmCalendarViewProps {
  entries: EntryRow[]
  sites: SiteOption[]
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



const QUARTER_LABELS: Record<AuFyQuarter, string> = {
  Q1: 'Q1 (Jul–Sep)',
  Q2: 'Q2 (Oct–Dec)',
  Q3: 'Q3 (Jan–Mar)',
  Q4: 'Q4 (Apr–Jun)',
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
    router.push(`/calendar?${params.toString()}`)
  }

  // Show deactivated toggle
  const showArchived = searchParams.get('show_archived') === '1'
  function toggleArchived() {
    const params = new URLSearchParams(searchParams.toString())
    if (showArchived) {
      params.delete('show_archived')
    } else {
      params.set('show_archived', '1')
    }
    params.delete('page')
    router.push(`/calendar?${params.toString()}`)
  }

  // Archive a single row (soft-delete via is_active=false)
  async function handleArchiveRow(id: string, title: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Archive "${title}"? It will be hidden from the list (use the Show Archived toggle to restore).`)) return
    const result = await togglePmCalendarActiveAction(id, false)
    if (result.success) router.refresh()
    else alert(`Error: ${result.error}`)
  }

  // CSV import handler
  const [importing, setImporting] = useState(false)
  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      const result = await importPmCalendarCsvAction(parsed)
      if (result.success) {
        alert(`Imported ${(result as { success: true; count: number }).count} entries.${(result as { success: true; skipped: number }).skipped ? ` Skipped ${(result as { success: true; skipped: number }).skipped} invalid rows.` : ''}`)
        router.refresh()
      } else {
        alert(`Import failed: ${result.error}`)
      }
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
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
    const summary: Record<string, Record<string, { count: number }>> = {}
    for (const e of entries) {
      const q = e.quarter ?? 'Unknown'
      const site = e.site_name
      if (!summary[q]) summary[q] = {}
      if (!summary[q][site]) summary[q][site] = { count: 0 }
      summary[q][site].count += 1
    }
    return summary
  }, [entries])

  // ===== CALENDAR VIEW DATA =====
  const calendarData = useMemo(() => {
    // Group entries by calendar month (Jan=0, Feb=1, ..., Dec=11)
    const months: Record<number, EntryRow[]> = {}
    for (let i = 0; i < 12; i++) months[i] = []

    for (const e of entries) {
      const d = new Date(e.start_time)
      const m = d.getMonth() // 0=Jan, 1=Feb, ..., 11=Dec
      if (months[m]) months[m].push(e)
    }
    return months
  }, [entries])

  // Filter options
  const siteOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const categoryOptions = categories.map((c) => ({ value: c, label: c }))
  const quarterOptions = [
    { value: 'Q1', label: 'Q1 (Jul–Sep)' },
    { value: 'Q2', label: 'Q2 (Oct–Dec)' },
    { value: 'Q3', label: 'Q3 (Jan–Mar)' },
    { value: 'Q4', label: 'Q4 (Apr–Jun)' },
  ]
  // FY options kept for data but removed from UI filters per Item 8
  const _fyOptions = financialYears.map((fy) => ({ value: fy, label: `FY ${fy}` }))
  const statusOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  // ===== TABLE COLUMNS (all sortable by default) =====
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
      sortAccessor: (row) => new Date(row.start_time).getTime(),
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
    ...(canWriteRole
      ? [{
          key: '__actions',
          header: 'Actions',
          sortable: false as const,
          className: 'w-20',
          render: (row: EntryRow) => (
            <button
              onClick={(e) => handleArchiveRow(row.id, row.title, e)}
              className="inline-flex items-center gap-1 text-xs text-eq-grey hover:text-red-600"
              title="Archive (soft-delete)"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive
            </button>
          ),
        }]
      : []),
  ]

  // CSV export rows
  const csvRows = entries.map((e) => ({
    site: e.site_name,
    title: e.title,
    location: e.location ?? '',
    description: e.description ?? '',
    category: e.category,
    start_time: e.start_time,
    end_time: e.end_time ?? '',
    quarter: e.quarter ?? '',
    financial_year: e.financial_year ?? '',
    status: e.status,
  }))
  const csvHeaders = [
    { key: 'site' as const, label: 'Site' },
    { key: 'title' as const, label: 'Title' },
    { key: 'location' as const, label: 'Location' },
    { key: 'description' as const, label: 'Description' },
    { key: 'category' as const, label: 'Category' },
    { key: 'start_time' as const, label: 'Start' },
    { key: 'end_time' as const, label: 'End' },
    { key: 'quarter' as const, label: 'Quarter' },
    { key: 'status' as const, label: 'Status' },
  ]

  // ===== TOTALS =====

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
            <button
              onClick={toggleArchived}
              className={`inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border transition-colors ${
                showArchived
                  ? 'border-eq-sky bg-eq-ice text-eq-deep'
                  : 'border-gray-200 bg-white text-eq-grey hover:bg-gray-50'
              }`}
              title={showArchived ? 'Hide deactivated checks' : 'Show deactivated checks'}
            >
              <Archive className="w-3.5 h-3.5 mr-1" />
              {showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>
            {isAdmin && entries.length === 0 && (
              <Button variant="secondary" size="sm" onClick={handleSeed} disabled={seeding}>
                {seeding ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Seeding...</> : 'Seed Data'}
              </Button>
            )}
            {canWriteRole && (
              <label className="inline-flex items-center">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleCsvImport}
                  disabled={importing}
                />
                <span className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-gray-200 bg-white text-eq-ink hover:bg-gray-50 cursor-pointer">
                  {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                  Import
                </span>
              </label>
            )}
            <CsvExportButton
              filename={`calendar-${new Date().toISOString().slice(0, 10)}`}
              rows={csvRows}
              headers={csvHeaders}
            />
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
            const qCount = siteKeys.reduce((s, k) => s + siteSummaries[k].count, 0)

            return (
              <div key={q} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="px-4 py-3 bg-eq-sky/5 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-eq-ink">{QUARTER_LABELS[q]}</h3>
                  <div className="flex items-center gap-4 text-xs text-eq-grey">
                    <span>{qCount} tasks</span>
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
                        </tr>
                      </thead>
                      <tbody>
                        {siteKeys.map((site) => (
                          <tr key={site} className="border-b border-gray-50">
                            <td className="py-1.5 font-medium text-eq-ink text-xs">{site}</td>
                            <td className="py-1.5 text-right tabular-nums text-xs">{siteSummaries[site].count}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-eq-ink">
                          <td className="pt-2 text-xs">Total</td>
                          <td className="pt-2 text-right tabular-nums text-xs">{qCount}</td>
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
