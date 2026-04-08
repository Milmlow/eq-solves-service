'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { AssetForm } from './AssetForm'
import { ImportAssetsModal } from './ImportAssetsModal'
import type { Asset, Site, JobPlan } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { Pencil, Upload } from 'lucide-react'

interface AssetWithSite extends Asset {
  sites: { name: string } | null
  job_plans: { name: string; code: string | null } | null
}

interface AssetListProps {
  assets: AssetWithSite[]
  sites: Pick<Site, 'id' | 'name'>[]
  assetTypes: string[]
  allJobPlans: Pick<JobPlan, 'id' | 'name' | 'code'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

export function AssetList({ assets, sites, assetTypes, allJobPlans, page, totalPages, isAdmin, canWrite: canWriteRole }: AssetListProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<AssetWithSite | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openDetail(asset: AssetWithSite) {
    setSelected(asset)
    setPanelOpen(true)
  }

  type AssetRow = AssetWithSite & Record<string, unknown>

  const columns: DataTableColumn<AssetRow>[] = [
    { key: 'maximo_id', header: 'Maximo ID' },
    { key: 'name', header: 'Name' },
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => (row as AssetWithSite).sites?.name ?? '—',
    },
    { key: 'location', header: 'Location' },
    {
      key: 'job_plan_name',
      header: 'Job Plan',
      render: (row) => {
        const a = row as AssetWithSite
        if (!a.job_plans) return '—'
        return a.job_plans.name
      },
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={(row as AssetWithSite).is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); openDetail(row as AssetWithSite) }}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <Pencil className="w-4 h-4 text-eq-grey" />
        </button>
      ),
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: s.name }))
  const typeFilterOptions = assetTypes.map((t) => ({ value: t, label: t }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search assets..."
          filters={[
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'asset_type', label: 'All Types', options: typeFilterOptions },
          ]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {canWriteRole && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          {canWriteRole && (
            <Button onClick={openCreate}>Add Asset</Button>
          )}
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No assets yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={openCreate}>Create your first asset</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={assets.map((a) => ({ ...a, site_name: '', actions: '' } as AssetRow))}
            emptyMessage="No assets match your filters."
            selectable={canWriteRole}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <AssetForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        asset={selected}
        sites={sites}
        jobPlans={allJobPlans}
        isAdmin={isAdmin}
        canWrite={canWriteRole}
      />

      <ImportAssetsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        sites={sites}
      />

      {canWriteRole && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Assets"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('assets', ids)}
          onDelete={(ids) => bulkDeleteAction('assets', ids)}
        />
      )}
    </>
  )
}
