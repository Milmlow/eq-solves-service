/**
 * Testing Summary — unified register of all tests across ACB, NSX and General testing.
 *
 * Allows the team to track tests that have been created and are being worked on
 * over a period of time. Filterable by site, status, type and date range.
 */

import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/format'
import { ChevronRight } from 'lucide-react'

type SummaryRow = {
  id: string
  kind: 'ACB' | 'NSX' | 'General'
  asset_name: string
  site_name: string
  test_date: string
  status: string
  progress: number
  detail_href: string
}

function statusChip(status: string) {
  const map: Record<string, string> = {
    complete: 'bg-green-50 text-green-700',
    'in-progress': 'bg-eq-ice text-eq-deep',
    'not-started': 'bg-gray-100 text-gray-600',
    pass: 'bg-green-50 text-green-700',
    fail: 'bg-red-50 text-red-600',
    pending: 'bg-gray-100 text-gray-600',
    defect: 'bg-amber-50 text-amber-700',
  }
  const cls = map[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase ${cls}`}>
      {status.replace('-', ' ')}
    </span>
  )
}

function acbProgress(test: { step1_status: string | null; step2_status: string | null; step3_status: string | null }): number {
  let done = 0
  if (test.step1_status === 'complete') done++
  if (test.step2_status === 'complete') done++
  if (test.step3_status === 'complete') done++
  return Math.round((done / 3) * 100)
}

function acbOverallStatus(test: { step1_status: string | null; step2_status: string | null; step3_status: string | null }): string {
  const pct = acbProgress(test)
  if (pct === 100) return 'complete'
  if (pct > 0) return 'in-progress'
  return 'not-started'
}

export default async function TestingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ site_id?: string; kind?: string; status?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const siteId = params.site_id ?? ''
  const kindFilter = params.kind ?? ''
  const statusFilter = params.status ?? ''
  const fromDate = params.from ?? ''
  const toDate = params.to ?? ''

  const supabase = await createClient()

  // Sites for filter
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  const siteMap = Object.fromEntries((sites ?? []).map((s) => [s.id, s.name]))

  // Fetch ACB tests
  let acbQuery = supabase
    .from('acb_tests')
    .select('id, asset_id, site_id, test_date, step1_status, step2_status, step3_status, assets(name)')
    .eq('is_active', true)
    .order('test_date', { ascending: false })
  if (siteId) acbQuery = acbQuery.eq('site_id', siteId)
  if (fromDate) acbQuery = acbQuery.gte('test_date', fromDate)
  if (toDate) acbQuery = acbQuery.lte('test_date', toDate)
  const { data: acbTests } = await acbQuery

  // Fetch NSX tests
  let nsxQuery = supabase
    .from('nsx_tests')
    .select('id, asset_id, site_id, test_date, overall_result, assets(name)')
    .eq('is_active', true)
    .order('test_date', { ascending: false })
  if (siteId) nsxQuery = nsxQuery.eq('site_id', siteId)
  if (fromDate) nsxQuery = nsxQuery.gte('test_date', fromDate)
  if (toDate) nsxQuery = nsxQuery.lte('test_date', toDate)
  const { data: nsxTests } = await nsxQuery

  // Fetch General test records
  let genQuery = supabase
    .from('test_records')
    .select('id, asset_id, site_id, test_date, result, test_type, assets(name)')
    .eq('is_active', true)
    .order('test_date', { ascending: false })
  if (siteId) genQuery = genQuery.eq('site_id', siteId)
  if (fromDate) genQuery = genQuery.gte('test_date', fromDate)
  if (toDate) genQuery = genQuery.lte('test_date', toDate)
  const { data: genTests } = await genQuery

  // Normalise into SummaryRow[]
  const rows: SummaryRow[] = []

  for (const t of acbTests ?? []) {
    const assetRaw = t.assets as unknown
    const asset = (Array.isArray(assetRaw) ? assetRaw[0] : assetRaw) as { name: string } | null
    const status = acbOverallStatus(t)
    rows.push({
      id: t.id as string,
      kind: 'ACB',
      asset_name: asset?.name ?? '—',
      site_name: siteMap[t.site_id as string] ?? '—',
      test_date: t.test_date as string,
      status,
      progress: acbProgress(t),
      detail_href: `/testing/acb`,
    })
  }

  for (const t of nsxTests ?? []) {
    const assetRaw = t.assets as unknown
    const asset = (Array.isArray(assetRaw) ? assetRaw[0] : assetRaw) as { name: string } | null
    rows.push({
      id: t.id as string,
      kind: 'NSX',
      asset_name: asset?.name ?? '—',
      site_name: siteMap[t.site_id as string] ?? '—',
      test_date: t.test_date as string,
      status: (t.overall_result as string) ?? 'pending',
      progress: t.overall_result === 'pass' || t.overall_result === 'fail' ? 100 : 0,
      detail_href: `/testing/nsx`,
    })
  }

  for (const t of genTests ?? []) {
    const assetRaw = t.assets as unknown
    const asset = (Array.isArray(assetRaw) ? assetRaw[0] : assetRaw) as { name: string } | null
    rows.push({
      id: t.id as string,
      kind: 'General',
      asset_name: asset?.name ?? '—',
      site_name: siteMap[t.site_id as string] ?? '—',
      test_date: t.test_date as string,
      status: (t.result as string) ?? 'pending',
      progress: t.result === 'pass' || t.result === 'fail' || t.result === 'defect' ? 100 : 0,
      detail_href: `/testing`,
    })
  }

  // Apply kind + status filters in memory
  const filtered = rows.filter((r) => {
    if (kindFilter && r.kind !== kindFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    return true
  })

  // Sort by test_date desc
  filtered.sort((a, b) => new Date(b.test_date).getTime() - new Date(a.test_date).getTime())

  // Counts
  const total = filtered.length
  const completeCount = filtered.filter((r) => r.status === 'complete' || r.status === 'pass').length
  const inProgressCount = filtered.filter((r) => r.status === 'in-progress').length
  const outstandingCount = filtered.filter(
    (r) => r.status === 'not-started' || r.status === 'pending' || r.status === 'in-progress',
  ).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-eq-ink">Testing Summary</h2>
        <p className="text-sm text-eq-grey mt-0.5">
          Register of all ACB, NSX and General tests — track work over time.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">Total Tests</p>
          <p className="text-3xl font-bold text-eq-ink">{total}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">Complete</p>
          <p className="text-3xl font-bold text-green-600">{completeCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">In Progress</p>
          <p className="text-3xl font-bold text-eq-deep">{inProgressCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase mb-1">Outstanding</p>
          <p className="text-3xl font-bold text-amber-600">{outstandingCount}</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <form className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Site</label>
            <select name="site_id" defaultValue={siteId} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All Sites</option>
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Type</label>
            <select name="kind" defaultValue={kindFilter} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All Types</option>
              <option value="ACB">ACB</option>
              <option value="NSX">NSX</option>
              <option value="General">General</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Status</label>
            <select name="status" defaultValue={statusFilter} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All Statuses</option>
              <option value="not-started">Not Started</option>
              <option value="in-progress">In Progress</option>
              <option value="complete">Complete</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="defect">Defect</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">From</label>
            <input type="date" name="from" defaultValue={fromDate} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">To</label>
            <input type="date" name="to" defaultValue={toDate} className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white" />
          </div>
          <div className="md:col-span-5 flex gap-2">
            <button type="submit" className="px-4 h-9 bg-eq-sky text-white rounded text-sm font-medium hover:bg-eq-deep">
              Apply Filters
            </button>
            <Link href="/testing/summary" className="px-4 h-9 inline-flex items-center bg-gray-100 text-eq-ink rounded text-sm font-medium hover:bg-gray-200">
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {/* Results table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Type</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Asset</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Site</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Test Date</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Progress</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-eq-grey uppercase">Status</th>
                <th className="text-right px-4 py-2 text-xs font-bold text-eq-grey uppercase">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-eq-grey text-sm">
                    No tests match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-eq-ice text-eq-deep">{r.kind}</span>
                    </td>
                    <td className="px-4 py-2 text-eq-ink font-medium">{r.asset_name}</td>
                    <td className="px-4 py-2 text-eq-grey">{r.site_name}</td>
                    <td className="px-4 py-2 text-eq-grey text-xs">{formatDate(r.test_date)}</td>
                    <td className="px-4 py-2 w-40">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.progress === 100 ? 'bg-green-500' : r.progress > 0 ? 'bg-eq-sky' : 'bg-gray-200'}`}
                            style={{ width: `${r.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-eq-grey w-10 text-right">{r.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">{statusChip(r.status)}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={r.detail_href} className="inline-flex items-center text-eq-sky hover:text-eq-deep text-xs font-medium">
                        Open <ChevronRight className="w-3 h-3 ml-0.5" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
