'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { JobPlanForm } from './JobPlanForm'
import { formatFrequency } from '@/lib/utils/format'
import type { JobPlan, JobPlanItem, Site, Frequency } from '@/lib/types'
import { Pencil } from 'lucide-react'

interface JobPlanWithSite extends JobPlan {
  sites: { name: string } | null
  item_count?: number
}

interface JobPlanListProps {
  jobPlans: JobPlanWithSite[]
  sites: Pick<Site, 'id' | 'name'>[]
  itemsMap: Record<string, JobPlanItem[]>
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

export function JobPlanList({ jobPlans, sites, itemsMap, page, totalPages, isAdmin, canWrite: canWriteRole }: JobPlanListProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<JobPlanWithSite | null>(null)

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openEdit(jp: JobPlanWithSite) {
    setSelected(jp)
    setPanelOpen(true)
  }

  type JPRow = JobPlanWithSite & Record<string, unknown>

  const columns: DataTableColumn<JPRow>[] = [
    { key: 'name', header: 'Name' },
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => (row as JobPlanWithSite).sites?.name ?? '—',
    },
    {
      key: 'frequency',
      header: 'Frequency',
      render: (row) => formatFrequency((row as JobPlanWithSite).frequency as Frequency),
    },
    {
      key: 'item_count',
      header: 'Tasks',
      render: (row) => String((row as JobPlanWithSite).item_count ?? 0),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={(row as JobPlanWithSite).is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); openEdit(row as JobPlanWithSite) }}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <Pencil className="w-4 h-4 text-eq-grey" />
        </button>
      ),
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: s.name }))
  const frequencyFilterOptions = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'biannual', label: 'Bi-annual' },
    { value: 'annual', label: 'Annual' },
    { value: 'ad_hoc', label: 'Ad Hoc' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search job plans..."
          filters={[
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'frequency', label: 'All Frequencies', options: frequencyFilterOptions },
          ]}
        />
        {canWriteRole && (
          <Button onClick={openCreate} className="ml-4 shrink-0">Add Job Plan</Button>
        )}
      </div>

      {jobPlans.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No job plans yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={openCreate}>Create your first job plan</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={jobPlans.map((jp) => ({ ...jp, site_name: '', actions: '' } as JPRow))}
            emptyMessage="No job plans match your filters."
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <JobPlanForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        jobPlan={selected}
        items={selected ? (itemsMap[selected.id] ?? []) : []}
        sites={sites}
        isAdmin={isAdmin}
        canWrite={canWriteRole}
      />
    </>
  )
}
