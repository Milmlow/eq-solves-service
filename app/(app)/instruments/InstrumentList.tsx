'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { InstrumentForm } from './InstrumentForm'
import { InstrumentDetail } from './InstrumentDetail'
import { formatDate } from '@/lib/utils/format'
import type { Instrument, InstrumentStatus, Profile } from '@/lib/types'
import { Eye } from 'lucide-react'

type InstrumentRow = Instrument & { assignee_name?: string | null } & Record<string, unknown>

interface InstrumentListProps {
  instruments: InstrumentRow[]
  instrumentTypes: string[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

function statusToBadge(status: InstrumentStatus): 'active' | 'inactive' | 'not-started' | 'blocked' {
  const map: Record<InstrumentStatus, 'active' | 'inactive' | 'not-started' | 'blocked'> = {
    Active: 'active',
    'Out for Cal': 'not-started',
    Retired: 'inactive',
    Lost: 'blocked',
  }
  return map[status]
}

export function InstrumentList({
  instruments, instrumentTypes, technicians, page, totalPages, isAdmin, canWrite: canWriteRole,
}: InstrumentListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editInst, setEditInst] = useState<InstrumentRow | null>(null)
  const [detailInst, setDetailInst] = useState<InstrumentRow | null>(null)

  const columns: DataTableColumn<InstrumentRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className="font-medium text-eq-ink">{row.name}</span>,
    },
    {
      key: 'instrument_type',
      header: 'Type',
      render: (row) => row.instrument_type,
    },
    {
      key: 'make_model',
      header: 'Make / Model',
      render: (row) => {
        const parts = [row.make, row.model].filter(Boolean)
        return parts.length > 0 ? parts.join(' — ') : '—'
      },
    },
    {
      key: 'serial_number',
      header: 'Serial',
      render: (row) => row.serial_number ?? '—',
    },
    {
      key: 'calibration_due',
      header: 'Cal Due',
      render: (row) => {
        if (!row.calibration_due) return '—'
        const due = new Date(row.calibration_due)
        const isOverdue = due < new Date()
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {formatDate(row.calibration_due)}
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={statusToBadge(row.status)} label={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); setDetailInst(row) }}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <Eye className="w-4 h-4 text-eq-grey" />
        </button>
      ),
    },
  ]

  const statusOptions = [
    { value: 'Active', label: 'Active' },
    { value: 'Out for Cal', label: 'Out for Cal' },
    { value: 'Retired', label: 'Retired' },
    { value: 'Lost', label: 'Lost' },
  ]
  const typeOptions = instrumentTypes.map((t) => ({ value: t, label: t }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search instruments..."
          filters={[
            { key: 'status', label: 'All Statuses', options: statusOptions },
            { key: 'instrument_type', label: 'All Types', options: typeOptions },
          ]}
        />
        {canWriteRole && (
          <Button onClick={() => setCreateOpen(true)} className="ml-4 shrink-0">Add Instrument</Button>
        )}
      </div>

      {instruments.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No instruments registered yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Add your first instrument</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={instruments.map((i) => ({ ...i, actions: '', make_model: '' }))} emptyMessage="No instruments match your filters." />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <InstrumentForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        technicians={technicians}
      />

      {editInst && (
        <InstrumentForm
          open={!!editInst}
          onClose={() => setEditInst(null)}
          instrument={editInst}
          technicians={technicians}
        />
      )}

      {detailInst && (
        <InstrumentDetail
          open={!!detailInst}
          onClose={() => setDetailInst(null)}
          instrument={detailInst}
          isAdmin={isAdmin}
          canWrite={canWriteRole}
          onEdit={() => { setEditInst(detailInst); setDetailInst(null) }}
        />
      )}
    </>
  )
}
