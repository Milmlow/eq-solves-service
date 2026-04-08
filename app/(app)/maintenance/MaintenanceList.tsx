'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { CreateCheckForm } from './CreateCheckForm'
import { BatchCreateForm } from './BatchCreateForm'
import { formatDate } from '@/lib/utils/format'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckStatus, JobPlan, Site, Profile } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { Calendar, LayoutGrid, List } from 'lucide-react'
import { KanbanBoard } from './KanbanBoard'

type CheckRow = MaintenanceCheck & {
  job_plans?: { name: string } | null
  sites?: { name: string } | null
  assignee_name?: string | null
  item_count?: number
  completed_count?: number
} & Record<string, unknown>

interface MaintenanceListProps {
  checks: CheckRow[]
  itemsMap: Record<string, MaintenanceCheckItem[]>
  jobPlans: Pick<JobPlan, 'id' | 'name' | 'code'>[]
  sites: Pick<Site, 'id' | 'name'>[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

function statusToBadge(status: CheckStatus) {
  const map: Record<CheckStatus, 'not-started' | 'in-progress' | 'complete' | 'blocked' | 'overdue'> = {
    scheduled: 'not-started',
    in_progress: 'in-progress',
    complete: 'complete',
    cancelled: 'blocked',
    overdue: 'overdue',
  }
  return map[status]
}

export function MaintenanceList({
  checks, itemsMap, jobPlans, sites, technicians,
  page, totalPages, isAdmin, canWrite: canWriteRole,
}: MaintenanceListProps) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const columns: DataTableColumn<CheckRow>[] = [
    {
      key: 'check_name',
      header: 'ID',
      render: (row) => (row as CheckRow).custom_name ?? row.job_plans?.name ?? '—',
    },
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => (row as CheckRow).sites?.name ?? '—',
    },
    {
      key: 'frequency',
      header: 'Frequency',
      render: (row) => {
        const f = (row as CheckRow).frequency
        if (!f) return '—'
        return f.replace('_', '-').replace(/\b\w/g, (c: string) => c.toUpperCase())
      },
    },
    {
      key: 'due_date',
      header: 'Due Date',
      render: (row) => formatDate(row.due_date as string),
    },
    {
      key: 'assigned',
      header: 'Assigned',
      render: (row) => (row as CheckRow).assignee_name ?? 'Unassigned',
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row) => {
        const r = row as CheckRow
        return `${r.completed_count ?? 0}/${r.item_count ?? 0}`
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={statusToBadge(row.status as CheckStatus)} />,
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: s.name }))
  const statusFilterOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search checks..."
          filters={[
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'status', label: 'All Statuses', options: statusFilterOptions },
          ]}
        />
        <div className="flex gap-2 ml-4 shrink-0">
          {/* View Toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-md p-1">
            <button
              onClick={() => setView('table')}
              className={`p-2 rounded transition-colors ${
                view === 'table'
                  ? 'bg-white text-eq-sky shadow-sm'
                  : 'text-eq-grey hover:text-eq-deep'
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('kanban')}
              className={`p-2 rounded transition-colors ${
                view === 'kanban'
                  ? 'bg-white text-eq-sky shadow-sm'
                  : 'text-eq-grey hover:text-eq-deep'
              }`}
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          {canWriteRole && (
            <>
              <Button onClick={() => setBatchOpen(true)} variant="secondary">
                <Calendar className="w-4 h-4 mr-2" />
                Batch Create
              </Button>
              <Button onClick={() => setCreateOpen(true)}>Create Check</Button>
            </>
          )}
        </div>
      </div>

      {checks.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No maintenance checks yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Create your first check</Button>
          )}
        </div>
      ) : (
        <>
          {view === 'table' ? (
            <>
              <DataTable
                columns={columns}
                rows={checks}
                emptyMessage="No checks match your filters."
                selectable={canWriteRole}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onRowClick={(row) => router.push(`/maintenance/${row.id}`)}
              />
              <Pagination page={page} totalPages={totalPages} />
            </>
          ) : (
            <KanbanBoard
              checks={checks}
              itemsMap={itemsMap}
              onCheckClick={(c) => router.push(`/maintenance/${c.id}`)}
            />
          )}
        </>
      )}

      <CreateCheckForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        jobPlans={jobPlans}
        sites={sites}
        technicians={technicians}
      />

      <BatchCreateForm
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        jobPlans={jobPlans}
        sites={sites}
        technicians={technicians}
      />

      {canWriteRole && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Checks"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('maintenance_checks', ids)}
          onDelete={(ids) => bulkDeleteAction('maintenance_checks', ids)}
        />
      )}
    </>
  )
}
