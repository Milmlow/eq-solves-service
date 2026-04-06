'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { CustomerForm } from './CustomerForm'
import type { Customer } from '@/lib/types'
import { cn } from '@/lib/utils/cn'
import { Pencil } from 'lucide-react'

interface CustomerListProps {
  customers: Customer[]
  page: number
  totalPages: number
  isAdmin: boolean
}

export function CustomerList({ customers, page, totalPages, isAdmin }: CustomerListProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openEdit(customer: Customer) {
    setSelected(customer)
    setPanelOpen(true)
  }

  const columns: DataTableColumn<Customer & Record<string, unknown>>[] = [
    { key: 'name', header: 'Name' },
    { key: 'code', header: 'Code' },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone' },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); openEdit(row as unknown as Customer) }}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <Pencil className="w-4 h-4 text-eq-grey" />
        </button>
      ),
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter placeholder="Search customers..." />
        {isAdmin && (
          <Button onClick={openCreate} className="ml-4 shrink-0">Add Customer</Button>
        )}
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No customers yet.</p>
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>Create your first customer</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={customers.map((c) => ({
              ...c,
              actions: '',
              className: cn(!c.is_active && 'opacity-50'),
            } as Customer & Record<string, unknown>))}
            emptyMessage="No customers match your search."
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <CustomerForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        customer={selected}
        isAdmin={isAdmin}
      />
    </>
  )
}
