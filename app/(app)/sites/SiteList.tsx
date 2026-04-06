'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { SiteForm } from './SiteForm'
import type { Site, Customer } from '@/lib/types'
import { Pencil } from 'lucide-react'
import Link from 'next/link'

interface SiteWithCustomer extends Site {
  customers: { name: string } | null
  asset_count?: number
}

interface SiteListProps {
  sites: SiteWithCustomer[]
  customers: Pick<Customer, 'id' | 'name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
}

export function SiteList({ sites, customers, page, totalPages, isAdmin }: SiteListProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<SiteWithCustomer | null>(null)

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openEdit(site: SiteWithCustomer) {
    setSelected(site)
    setPanelOpen(true)
  }

  type SiteRow = SiteWithCustomer & Record<string, unknown>

  const columns: DataTableColumn<SiteRow>[] = [
    { key: 'name', header: 'Name' },
    { key: 'code', header: 'Code' },
    {
      key: 'customer_name',
      header: 'Customer',
      render: (row) => (row as SiteWithCustomer).customers?.name ?? '—',
    },
    { key: 'city', header: 'City' },
    { key: 'state', header: 'State' },
    {
      key: 'asset_count',
      header: 'Assets',
      render: (row) => {
        const site = row as SiteWithCustomer
        const count = site.asset_count ?? 0
        return count > 0 ? (
          <Link
            href={`/assets?site_id=${site.id}`}
            className="text-eq-sky hover:text-eq-deep transition-colors font-medium"
          >
            {count}
          </Link>
        ) : (
          <span className="text-eq-grey">0</span>
        )
      },
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={(row as SiteWithCustomer).is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); openEdit(row as SiteWithCustomer) }}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <Pencil className="w-4 h-4 text-eq-grey" />
        </button>
      ),
    },
  ]

  const customerFilterOptions = customers.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search sites..."
          filters={[{ key: 'customer_id', label: 'All Customers', options: customerFilterOptions }]}
        />
        {isAdmin && (
          <Button onClick={openCreate} className="ml-4 shrink-0">Add Site</Button>
        )}
      </div>

      {sites.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No sites yet.</p>
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>Create your first site</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={sites.map((s) => ({ ...s, customer_name: '', actions: '' } as SiteRow))}
            emptyMessage="No sites match your filters."
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <SiteForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        site={selected}
        customers={customers}
        isAdmin={isAdmin}
      />
    </>
  )
}
