'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { AcbTestForm } from './AcbTestForm'
import { AcbTestDetail } from './AcbTestDetail'
import { formatDate, formatAcbTestResult, formatSiteLabel } from '@/lib/utils/format'
import type { AcbTest, AcbTestReading, AcbTestResult, Asset, Site, Profile, Attachment } from '@/lib/types'

type SiteOption = Pick<Site, 'id' | 'name'> & {
  code?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}
import { FileText } from 'lucide-react'
import { ReportDownloadDialog } from '@/components/ui/ReportDownloadDialog'
import type { ReportComplexity } from '@/components/ui/ReportDownloadDialog'
import { events as analyticsEvents } from '@/lib/analytics'

type TestRow = AcbTest & {
  assets?: { name: string; asset_type: string } | null
  sites?: { name: string } | null
  tester_name?: string | null
} & Record<string, unknown>

interface AcbTestListProps {
  tests: TestRow[]
  readingsMap: Record<string, AcbTestReading[]>
  attachmentsMap: Record<string, Attachment[]>
  assets: Pick<Asset, 'id' | 'name' | 'asset_type' | 'site_id'>[]
  sites: SiteOption[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

function resultToBadge(result: AcbTestResult): 'not-started' | 'complete' | 'blocked' | 'in-progress' {
  const map: Record<AcbTestResult, 'not-started' | 'complete' | 'blocked' | 'in-progress'> = {
    Pending: 'not-started',
    Pass: 'complete',
    Fail: 'blocked',
    Defect: 'blocked',
  }
  return map[result]
}

export function AcbTestList({
  tests, readingsMap, attachmentsMap, assets, sites, technicians,
  page, totalPages, isAdmin, canWrite: canWriteRole,
}: AcbTestListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTest, setEditTest] = useState<TestRow | null>(null)
  const [detailTest, setDetailTest] = useState<TestRow | null>(null)
  const [reportSiteId, setReportSiteId] = useState('')
  const [reportDialogOpen, setReportDialogOpen] = useState(false)

  async function handleGenerateReport(complexity: ReportComplexity) {
    if (!reportSiteId) return
    const res = await fetch(`/api/acb-report?site_id=${reportSiteId}&complexity=${complexity}`)
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
    a.download = match?.[1] ?? 'ACB Test Report.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    const assetCount = tests.filter((t) => (t as { site_id?: string }).site_id === reportSiteId).length
    analyticsEvents.reportGenerated({
      report_type: `acb_${complexity}`,
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
      key: 'test_type',
      header: 'Type',
      render: (row) => row.test_type,
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
      key: 'tested_by_name',
      header: 'Tested By',
      render: (row) => (row as TestRow).tester_name ?? '—',
    },
    {
      key: 'overall_result',
      header: 'Result',
      render: (row) => <StatusBadge status={resultToBadge(row.overall_result)} label={formatAcbTestResult(row.overall_result)} />,
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
          placeholder="Search ACB tests..."
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
            <Button size="sm" onClick={() => setCreateOpen(true)}>Add ACB Test</Button>
          )}
        </div>
      </div>

      {tests.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No ACB test records yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Create your first ACB test</Button>
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

      <AcbTestForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        assets={assets}
        sites={sites}
        technicians={technicians}
      />

      {editTest && (
        <AcbTestForm
          open={!!editTest}
          onClose={() => setEditTest(null)}
          test={editTest}
          assets={assets}
          sites={sites}
          technicians={technicians}
        />
      )}

      {detailTest && (
        <AcbTestDetail
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
        title="ACB Test Report"
      />
    </>
  )
}
