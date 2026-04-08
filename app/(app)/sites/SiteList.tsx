'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { SiteForm } from './SiteForm'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importSitesAction } from './actions'
import type { Site, Customer } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { Upload } from 'lucide-react'
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
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const siteImportConfig: ImportCSVConfig<{
    name: string
    code: string | null
    customer_name: string | null
    address: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
  }> = {
    entityName: 'Sites',
    requiredColumns: ['name'],
    optionalColumns: ['code', 'customer', 'address', 'city', 'state', 'postcode', 'country'],
    // No blocking validation — server action auto-creates missing customers
    mapRow: (row, columnMap) => {
      const name = row[columnMap['name']]?.trim()
      if (!name) return null
      return {
        name,
        code: row[columnMap['code']]?.trim() || null,
        customer_name: row[columnMap['customer']]?.trim() || null,
        address: row[columnMap['address']]?.trim() || null,
        city: row[columnMap['city']]?.trim() || null,
        state: row[columnMap['state']]?.trim() || null,
        postcode: row[columnMap['postcode']]?.trim() || null,
        country: row[columnMap['country']]?.trim() || null,
      }
    },
    importAction: importSitesAction,
  }

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
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <Link href={`/sites/${(row as SiteWithCustomer).id}`} className="text-eq-sky hover:text-eq-deep font-medium transition-colors">
          {(row as SiteWithCustomer).name}
        </Link>
      ),
    },
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
  ]

  const customerFilterOptions = customers.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search sites..."
          filters={[{ key: 'customer_id', label: 'All Customers', options: customerFilterOptions }]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          {isAdmin && (
            <Button onClick={openCreate}>Add Site</Button>
          )}
        </div>
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
            rows={sites.map((s) => ({ ...s, customer_name: '' } as SiteRow))}
            emptyMessage="No sites match your filters."
            selectable={isAdmin}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onRowClick={(row) => openEdit(row as SiteWithCustomer)}
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

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={siteImportConfig}
      />

      {isAdmin && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Sites"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('sites', ids)}
          onDelete={(ids) => bulkDeleteAction('sites', ids)}
        />
      )}
    </>
  )
}
