'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { NsxTestForm } from './NsxTestForm'
import { NsxTestDetail } from './NsxTestDetail'
import { formatDate, formatNsxTestResult, formatSiteLabel } from '@/lib/utils/format'
import type { NsxTest, NsxTestReading, NsxTestResult, Asset, Site, Profile, Attachment } from '@/lib/types'
import { FileText } from 'lucide-react'
import { ReportDownloadDialog } from '@/components/ui/ReportDownloadDialog'
import type { ReportComplexity } from '@/components/ui/ReportDownloadDialog'
import { events as analyticsEvents } from '@/lib/analytics'

type TestRow = NsxTest & {
  assets?: { name: string; asset_type: string } | null
  sites?: { name: string } | null
  tester_name?: string | null
} & Record<string, unknown>

interface NsxTestListProps {
  tests: TestRow[]
  readingsMap: Record<string, NsxTestReading[]>
  attachmentsMap: Record<string, Attachment[]>
  assets: Pick<Asset, 'id' | 'name' | 'asset_type' | 'site_id'>[]
  sites: (Pick<Site, 'id' | 'name'> & {
    code?: string | null
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

function resultToBadge(result: NsxTestResult): 'not-started' | 'complete' | 'blocked' | 'in-progress' {
  const map: Record<NsxTestResult, 'not-started' | 'complete' | 'blocked' | 'in-progress'> = {
    Pending: 'not-started',
    Pass: 'complete',
    Fail: 'blocked',
    Defect: 'blocked',
  }
  return map[result]
}

export function NsxTestList({
  tests, readingsMap, attachmentsMap, assets, sites, technicians,
  page, totalPages, isAdmin, canWrite: canWriteRole,
}: NsxTestListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTest, setEditTest] = useState<TestRow | null>(null)
  const [detailTest, setDetailTest] = useState<TestRow | null>(null)
  const [reportSiteId, setReportSiteId] = useState('')
  const [reportDialogOpen, setReportDialogOpen] = useState(false)

  async function handleGenerateReport(complexity: ReportComplexity) {
    if (!reportSiteId) return
    const res = await fetch(`/api/nsx-report?site_id=${reportSiteId}&complexity=${complexity}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }))
      alert(err.error ?? 'Report generation failed')
      throw new Error(err.error)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const disposition = res.headers.get('Content-Disposition')
    const match = disposition?.match(/filename="(.+?)"/)
    a.download = match?.[1] ?? 'NSX Test Report.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    const assetCount = tests.filter((t) => (t as { site_id?: string }).site_id === reportSiteId).length
    analyticsEvents.reportGenerated({
      report_type: `nsx_${complexity}`,
      asset_count: assetCount,
    })
  }

  const columns: DataTableColumn<TestRow>[] = [
    {
      key: 'asset_name',
      header: 'Asset',
      render: (row) => (
        <div>
          <span className="font-medium text-eq-ink">{row.assets?.name ?? '—'}</span>
          {row.assets?.asset_type && (
            <span className="ml-2 text-xs text-eq-grey">{row.assets.asset_type}</span>
          )}
        </div>
      ),
    },
    {
      key: 'cb_make',
      header: 'CB Make/Model',
      render: (row) => {
        const parts = [row.cb_make, row.cb_model].filter(Boolean)
        return parts.length > 0 ? parts.join(' — ') : '—'
      },
    },
    {
      key: 'cb_rating',
      header: 'Rating',
      render: (row) => row.cb_rating ?? '—',
    },
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => row.sites?.name ?? '—',
    },
    {
      key: 'test_date',
      header: 'Test Date',
      render: (row) => formatDate(row.test_date),
    },
    {
      key: 'overall_result',
      header: 'Result',
      render: (row) => <StatusBadge status={resultToBadge(row.overall_result)} label={formatNsxTestResult(row.overall_result)} />,
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const resultFilterOptions = [
    { value: 'Pending', label: 'Pending' },
    { value: 'Pass', label: 'Pass' },
    { value: 'Fail', label: 'Fail' },
    { value: 'Defect', label: 'Defect' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search NSX tests..."
          filters={[
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'overall_result', label: 'All Results', options: resultFilterOptions },
          ]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {canWriteRole && (
            <div className="flex items-center gap-2">
              <select
                value={reportSiteId}
                onChange={(e) => setReportSiteId(e.target.value)}
                className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              >
                <option value="">Site for report...</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReportDialogOpen(true)}
                disabled={!reportSiteId}
              >
                <FileText className="w-4 h-4 mr-1.5" />
                Report
              </Button>
            </div>
          )}
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Add NSX Test</Button>
          )}
        </div>
      </div>

      {tests.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No NSX test records yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Create your first NSX test</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={tests}
            emptyMessage="No tests match your filters."
            onRowClick={(row) => setDetailTest(row as TestRow)}
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <NsxTestForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        assets={assets}
        sites={sites}
        technicians={technicians}
      />

      {editTest && (
        <NsxTestForm
          open={!!editTest}
          onClose={() => setEditTest(null)}
          test={editTest}
          assets={assets}
          sites={sites}
          technicians={technicians}
        />
      )}

      {detailTest && (
        <NsxTestDetail
          open={!!detailTest}
          onClose={() => setDetailTest(null)}
          test={detailTest}
          readings={readingsMap[detailTest.id] ?? []}
          attachments={attachmentsMap[detailTest.id] ?? []}
          assets={assets}
          sites={sites}
          technicians={technicians}
          isAdmin={isAdmin}
          canWrite={canWriteRole}
          onEdit={() => { setEditTest(detailTest); setDetailTest(null) }}
        />
      )}

      <ReportDownloadDialog
        open={reportDialogOpen}
        onClose={() => setReportDialogOpen(false)}
        onDownload={handleGenerateReport}
        title="NSX Test Report"
      />
    </>
  )
}
