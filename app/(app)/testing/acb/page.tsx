'use client'

/**
 * ACB Testing — home screen shows all ACB checks. Create Check sub-view
 * lets you pick a site (filtered to E1.25/LVACB plan assets), use the
 * Import / Export / Breaker Details tools, select breakers, and create
 * a maintenance_check + acb_test rows.
 *
 * Tests are worked from /maintenance/[id] (Linked Tests panel → /testing/acb/[testId]).
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { AcbSiteCollection } from './AcbSiteCollection'
import { AcbMaximoImportModal } from './AcbMaximoImportModal'
import { ClipboardList, Download, Upload, Plus, ChevronRight } from 'lucide-react'
import type { AcbTest, AcbTestReading, Asset } from '@/lib/types'
import { updateAcbDetailsAction, importAcbCollectionAction } from '@/app/(app)/testing/acb/actions'
import {
  exportAcbCollectionXlsx,
  parseAcbCollectionXlsx,
  buildAcbImportErrorCsv,
  type AcbImportRowResult,
  type AcbParseRowError,
} from '@/lib/utils/acb-excel'
import { createTestingCheckAction } from '@/app/(app)/testing/check-actions'
import { formatSiteLabel } from '@/lib/utils/format'

type SitePick = {
  id: string
  name: string
  code?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

type CheckRow = {
  id: string
  name: string
  site_name: string
  status: string
  total_tests: number
  complete_tests: number
  due_date: string | null
}

const FREQUENCIES = ['Annual', '5 Yearly', 'Semi-Annual', 'Quarterly', 'Monthly'] as const
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const STATUS_STYLES: Record<string, string> = {
  complete:    'bg-green-100 text-green-700',
  in_progress: 'bg-amber-100 text-amber-700',
  scheduled:   'bg-sky-100 text-sky-700',
  cancelled:   'bg-gray-100 text-gray-500',
}

export default function AcbTestingPage() {
  const router = useRouter()
  const supabase = createClient()

  // ── Home view ──────────────────────────────────────────────────────────────
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [checksLoading, setChecksLoading] = useState(true)

  // ── Create Check sub-view ─────────────────────────────────────────────────
  const [showCreateCheck, setShowCreateCheck] = useState(false)
  const [showSiteCollection, setShowSiteCollection] = useState(false)
  const [showMaximoImport, setShowMaximoImport] = useState(false)

  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [assets, setAssets] = useState<(Asset & { acb_test?: AcbTest })[]>([])
  const [readings, setReadings] = useState<Record<string, AcbTestReading[]>>({})
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [noAssets, setNoAssets] = useState(false)
  const [jobPlanId, setJobPlanId] = useState<string | null>(null)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [assetFilter, setAssetFilter] = useState('')
  const [checkFrequency, setCheckFrequency] = useState('Annual')
  const [checkMonth, setCheckMonth] = useState(new Date().getMonth() + 1)
  const [checkYear, setCheckYear] = useState(new Date().getFullYear())
  const [checkStartDate, setCheckStartDate] = useState('')
  const [checkDueDate, setCheckDueDate] = useState('')
  const [checkAssignedTo, setCheckAssignedTo] = useState('')
  const [customCheckName, setCustomCheckName] = useState('')
  const [tenantMembers, setTenantMembers] = useState<
    { id: string; full_name: string | null; email: string | null }[]
  >([])
  const [creatingCheck, setCreatingCheck] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  // Import state
  const [importing, setImporting] = useState(false)
  type ImportResultDetail = {
    updated: number
    failed: number
    parseErrors: AcbParseRowError[]
    rowResults: AcbImportRowResult[]
    siteName: string
  }
  const [importResult, setImportResult] = useState<ImportResultDetail | null>(null)

  // ── Load checks for home list ──────────────────────────────────────────────
  async function loadChecks() {
    setChecksLoading(true)

    const { data: checksData } = await supabase
      .from('maintenance_checks')
      .select('id, custom_name, status, due_date, site_id')
      .eq('kind', 'acb')
      .eq('is_active', true)
      .order('due_date', { ascending: false, nullsFirst: false })

    if (!checksData || checksData.length === 0) {
      setChecks([])
      setChecksLoading(false)
      return
    }

    // Site name map
    const siteIds = [...new Set(checksData.map((c) => c.site_id as string).filter(Boolean))]
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, name')
      .in('id', siteIds)
    const siteMap = Object.fromEntries((sitesData ?? []).map((s) => [s.id, s.name]))

    // Test counts per check
    const checkIds = checksData.map((c) => c.id as string)
    const { data: testData } = await supabase
      .from('acb_tests')
      .select('check_id, step1_status, step2_status, step3_status')
      .in('check_id', checkIds)
      .eq('is_active', true)

    const countMap = new Map<string, { total: number; complete: number }>()
    for (const t of testData ?? []) {
      const cid = t.check_id as string
      if (!countMap.has(cid)) countMap.set(cid, { total: 0, complete: 0 })
      const entry = countMap.get(cid)!
      entry.total++
      if (
        t.step1_status === 'complete' &&
        t.step2_status === 'complete' &&
        t.step3_status === 'complete'
      ) entry.complete++
    }

    setChecks(
      checksData.map((c) => ({
        id: c.id as string,
        name: (c.custom_name as string | null) ?? '(unnamed check)',
        site_name: siteMap[c.site_id as string] ?? '—',
        status: (c.status as string) ?? 'scheduled',
        total_tests: countMap.get(c.id as string)?.total ?? 0,
        complete_tests: countMap.get(c.id as string)?.complete ?? 0,
        due_date: c.due_date as string | null,
      }))
    )
    setChecksLoading(false)
  }

  useEffect(() => { loadChecks() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load E1.25-filtered sites (Create Check only) ─────────────────────────
  useEffect(() => {
    if (!showCreateCheck) return
    async function loadE125Sites() {
      const { data: jobPlans } = await supabase
        .from('job_plans')
        .select('id, name, code')
        .eq('is_active', true)

      const e125Plans = (jobPlans ?? []).filter(
        (jp) => jp.name === 'E1.25' || jp.code === 'LVACB'
      )
      if (!e125Plans.length) { setSites([]); return }

      const { data: assetRows } = await supabase
        .from('assets')
        .select('site_id')
        .in('job_plan_id', e125Plans.map((p) => p.id))
        .eq('is_active', true)

      const siteIds = [
        ...new Set((assetRows ?? []).map((a) => a.site_id).filter(Boolean)),
      ] as string[]
      if (!siteIds.length) { setSites([]); return }

      const { data } = await supabase
        .from('sites')
        .select('id, name, code, customers(name)')
        .eq('is_active', true)
        .in('id', siteIds)
        .order('name')
      setSites((data ?? []) as SitePick[])
    }
    loadE125Sites()
  }, [showCreateCheck])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load tenant members (Create Check only)
  useEffect(() => {
    if (!showCreateCheck) return
    async function loadMembers() {
      const { data } = await supabase
        .from('tenant_members')
        .select('user_id, role, profiles(id, full_name, email)')
        .eq('is_active', true)
        .in('role', ['manager', 'supervisor', 'employee'])
      const members = (data ?? []).flatMap((m) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (!p) return []
        return [{
          id: m.user_id,
          full_name: (p as { full_name?: string | null }).full_name ?? null,
          email: (p as { email?: string | null }).email ?? null,
        }]
      })
      setTenantMembers(members)
    }
    loadMembers()
  }, [showCreateCheck])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load E1.25 assets + latest tests for selected site
  const loadSiteData = useCallback(async () => {
    if (!selectedSite) { setAssets([]); setReadings({}); setNoAssets(false); return }
    setAssetsLoading(true)

    const { data: jobPlans } = await supabase
      .from('job_plans')
      .select('id, name, code')
      .eq('is_active', true)

    const e125Plans = (jobPlans ?? []).filter(
      (jp) => jp.name === 'E1.25' || jp.code === 'LVACB'
    )

    if (!e125Plans.length) {
      setNoAssets(true)
      setAssets([])
      setReadings({})
      setJobPlanId(null)
      setAssetsLoading(false)
      return
    }

    setJobPlanId(e125Plans[0].id)

    const { data: assetsData } = await supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .in('job_plan_id', e125Plans.map((p) => p.id))
      .eq('is_active', true)
      .order('name')

    if (!assetsData || assetsData.length === 0) {
      setNoAssets(true)
      setAssets([])
      setReadings({})
      setAssetsLoading(false)
      return
    }

    setNoAssets(false)
    const assetIds = assetsData.map((a) => a.id)

    const { data: testsData } = await supabase
      .from('acb_tests')
      .select('*')
      .in('asset_id', assetIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    const testMap = new Map<string, AcbTest>()
    for (const t of (testsData ?? []) as AcbTest[]) {
      if (!testMap.has(t.asset_id)) testMap.set(t.asset_id, t)
    }

    const combined = assetsData.map((a) => ({
      ...(a as Asset),
      acb_test: testMap.get(a.id),
    }))

    // Readings map
    const testIds = Array.from(testMap.values()).map((t) => t.id)
    if (testIds.length) {
      const { data: readingsData } = await supabase
        .from('acb_test_readings')
        .select('*')
        .in('acb_test_id', testIds)
        .order('sort_order')
      const rdgMap: Record<string, AcbTestReading[]> = {}
      for (const r of readingsData ?? []) {
        const key = r.acb_test_id as string
        if (!rdgMap[key]) rdgMap[key] = []
        rdgMap[key].push(r as AcbTestReading)
      }
      setReadings(rdgMap)
    } else {
      setReadings({})
    }

    setAssets(combined)
    setAssetsLoading(false)
  }, [selectedSite, supabase])

  useEffect(() => { loadSiteData() }, [selectedSite])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Import / Export ────────────────────────────────────────────────────────
  function handleExport() {
    const siteName = sites.find((s) => s.id === selectedSite)?.name ?? 'Site'
    exportAcbCollectionXlsx(siteName, assets)
  }

  async function handleImport(file: File) {
    setImporting(true)
    setImportResult(null)
    const siteName = sites.find((s) => s.id === selectedSite)?.name ?? 'Site'
    try {
      if (file.size > 10 * 1024 * 1024) {
        setImportResult({
          updated: 0, failed: 0,
          parseErrors: [{ rowNumber: 0, reason: 'File is over 10 MB — split the workbook.' }],
          rowResults: [], siteName,
        })
        return
      }
      const { rows: parsedRows, errors: parseErrors } = await parseAcbCollectionXlsx(file)
      const assetIndex = new Map(assets.map((a) => [a.id, a.name]))
      const payloadRows = parsedRows.map((r, idx) => ({
        ...r,
        rowNumber: idx + 2,
        assetName: assetIndex.get(r.asset_id) ?? null,
      }))
      const result = await importAcbCollectionAction({
        rows: payloadRows,
        mutationId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID() : null,
      })
      if (!result.success) {
        setImportResult({
          updated: 0, failed: parsedRows.length, parseErrors,
          rowResults: payloadRows.map((r) => ({
            test_id: r.test_id, rowNumber: r.rowNumber,
            assetName: r.assetName ?? undefined, ok: false, reason: result.error,
          })),
          siteName,
        })
      } else {
        const d = result.data ?? { updated: 0, failed: 0, rowResults: [] }
        setImportResult({
          updated: d.updated, failed: d.failed + parseErrors.length,
          parseErrors, rowResults: d.rowResults, siteName,
        })
      }
      await loadSiteData()
    } catch (e) {
      setImportResult({
        updated: 0, failed: 1,
        parseErrors: [{ rowNumber: 0, reason: e instanceof Error ? e.message : 'Unexpected error.' }],
        rowResults: [], siteName,
      })
    }
    setImporting(false)
  }

  function downloadAcbImportErrorReport() {
    if (!importResult) return
    const csv = buildAcbImportErrorCsv(importResult.parseErrors, importResult.rowResults)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${importResult.siteName.replace(/[^a-zA-Z0-9_-]/g, '_')}_ACB_Import_Errors.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleCreateCheck() {
    setCreatingCheck(true)
    setCheckError(null)
    const monthDate = new Date(checkYear, checkMonth - 1, 1).toISOString().slice(0, 10)
    try {
      const result = await createTestingCheckAction({
        site_id: selectedSite,
        job_plan_id: jobPlanId,
        check_type: 'acb',
        frequency: checkFrequency,
        month: checkMonth,
        year: checkYear,
        asset_ids: Array.from(selectedAssetIds),
        start_date: checkStartDate || monthDate,
        due_date: checkDueDate || monthDate,
        assigned_to: checkAssignedTo || undefined,
        custom_name: customCheckName.trim() || undefined,
      })
      if (result.success && result.data?.checkId) {
        router.push(`/maintenance/${result.data.checkId}`)
        return
      }
      setCheckError(result.success ? 'Failed to create check.' : (result.error ?? null))
    } catch {
      setCheckError('An unexpected error occurred.')
    }
    setCreatingCheck(false)
  }

  function toggleAsset(id: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedAssetIds(new Set(assets.map((a) => a.id)))
  }

  function deselectAll() {
    setSelectedAssetIds(new Set())
  }

  // ── Site Collection sub-view ───────────────────────────────────────────────
  if (showSiteCollection && selectedSite) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '/testing/acb' },
              { label: 'Asset Collection' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-ink mt-2">ACB Asset Collection</h2>
          <p className="text-eq-grey text-sm mt-1">Site-level breaker identification and settings</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowSiteCollection(false)}>
          Back to Create Check
        </Button>
        <AcbSiteCollection assets={assets} onUpdate={loadSiteData} />
      </div>
    )
  }

  // ── Create Check sub-view ──────────────────────────────────────────────────
  if (showCreateCheck) {
    const siteName = sites.find((s) => s.id === selectedSite)?.name ?? 'Site'
    const filterLower = assetFilter.toLowerCase()
    const filtered = filterLower
      ? assets.filter(
          (a) =>
            a.name.toLowerCase().includes(filterLower) ||
            (a.serial_number ?? '').toLowerCase().includes(filterLower)
        )
      : assets

    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '/testing/acb' },
              { label: 'Create Check' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-ink mt-2">Create ACB Check</h2>
          <p className="text-eq-grey text-sm mt-1">
            Select a site, pick the assets, then confirm to create the check.
          </p>
        </div>

        {/* Sticky action bar */}
        <div className="sticky top-0 z-10 -mx-4 lg:-mx-8 px-4 lg:px-8 py-2.5 bg-white/95 backdrop-blur-sm border-b border-gray-200 flex items-center justify-between gap-3">
          <Button
            onClick={handleCreateCheck}
            disabled={creatingCheck || selectedAssetIds.size === 0 || !selectedSite}
          >
            {creatingCheck
              ? 'Creating…'
              : `Create Check (${selectedAssetIds.size} asset${selectedAssetIds.size !== 1 ? 's' : ''})`}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowCreateCheck(false)}>
            Cancel
          </Button>
        </div>

        {/* Site selector + data tools */}
        <Card>
          <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Site</label>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedSite}
              onChange={(e) => {
                setSelectedSite(e.target.value)
                setSelectedAssetIds(new Set())
                setImportResult(null)
                setShowSiteCollection(false)
              }}
              className="flex-1 min-w-48 h-10 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
            >
              <option value="">Choose a site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
              ))}
            </select>
            {selectedSite && assets.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => document.getElementById('acb-import-file')?.click()}
                  disabled={importing}
                >
                  <Upload className="w-4 h-4 mr-1" />
                  {importing ? 'Importing…' : 'Import'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowMaximoImport(true)}>
                  <Upload className="w-4 h-4 mr-1" />
                  Import from Maximo
                </Button>
                <Button size="sm" variant="secondary" onClick={handleExport}>
                  <Download className="w-4 h-4 mr-1" />
                  Export
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowSiteCollection(true)}>
                  <ClipboardList className="w-4 h-4 mr-1" />
                  Breaker Details
                </Button>
                <input
                  id="acb-import-file"
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImport(file)
                    e.target.value = ''
                  }}
                />
              </>
            )}
          </div>

          {importResult && (
            <div
              className={`mt-2 p-3 rounded-md text-sm space-y-2 ${
                importResult.failed > 0
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-green-50 border border-green-200 text-green-700'
              }`}
            >
              <div className="font-semibold">
                Import complete: {importResult.updated} updated
                {importResult.failed > 0 ? `, ${importResult.failed} failed` : ''}
              </div>
              {importResult.failed > 0 && (
                <>
                  <ul className="list-disc list-inside text-xs space-y-0.5 max-h-32 overflow-y-auto">
                    {importResult.parseErrors.slice(0, 5).map((e, i) => (
                      <li key={`pe-${i}`}>
                        Row {e.rowNumber}
                        {(e as AcbParseRowError & { assetName?: string }).assetName
                          ? ` (${(e as AcbParseRowError & { assetName?: string }).assetName})`
                          : ''}: {e.reason}
                      </li>
                    ))}
                    {importResult.rowResults
                      .filter((r) => !r.ok)
                      .slice(0, Math.max(0, 5 - importResult.parseErrors.length))
                      .map((r) => (
                        <li key={`rr-${r.test_id}-${r.rowNumber}`}>
                          Row {r.rowNumber}
                          {r.assetName ? ` (${r.assetName})` : ''}: {r.reason ?? 'Update failed'}
                        </li>
                      ))}
                  </ul>
                  {importResult.failed > 5 && (
                    <p className="text-xs italic">
                      …and {importResult.failed - 5} more. Download the report for the full list.
                    </p>
                  )}
                  <button
                    type="button"
                    className="text-xs font-semibold underline hover:no-underline"
                    onClick={downloadAcbImportErrorReport}
                  >
                    Download error report (CSV)
                  </button>
                </>
              )}
            </div>
          )}
        </Card>

        {/* Check details */}
        <Card>
          <h3 className="text-sm font-bold text-eq-ink mb-4">Check Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Frequency</label>
              <select
                value={checkFrequency}
                onChange={(e) => setCheckFrequency(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Month</label>
              <select
                value={checkMonth}
                onChange={(e) => setCheckMonth(Number(e.target.value))}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Year</label>
              <select
                value={checkYear}
                onChange={(e) => setCheckYear(Number(e.target.value))}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                {[2024, 2025, 2026, 2027, 2028].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Start Date</label>
              <input
                type="date"
                value={checkStartDate}
                onChange={(e) => setCheckStartDate(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Due Date</label>
              <input
                type="date"
                value={checkDueDate}
                onChange={(e) => setCheckDueDate(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Assigned To</label>
              <select
                value={checkAssignedTo}
                onChange={(e) => setCheckAssignedTo(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                <option value="">Unassigned</option>
                {tenantMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email || m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Check Name</label>
            <input
              type="text"
              value={customCheckName}
              onChange={(e) => setCustomCheckName(e.target.value)}
              placeholder={`${siteName} ${checkFrequency} ${jobPlanId ? 'E1.25' : ''} ${MONTHS[checkMonth - 1]} ${checkYear}`}
              className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
            />
            <p className="text-xs text-eq-grey mt-1">Leave blank to use the auto-generated name.</p>
          </div>
        </Card>

        {/* Asset selection */}
        {selectedSite && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-eq-ink">Select Assets</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={selectAll}>Select All</Button>
                <Button size="sm" variant="secondary" onClick={deselectAll}>Deselect All</Button>
              </div>
            </div>
            <div className="mb-3">
              <input
                type="text"
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                placeholder="Filter by name or serial…"
                className="w-full h-9 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              />
            </div>
            {assetsLoading ? (
              <p className="text-sm text-eq-grey py-4 text-center">Loading assets…</p>
            ) : noAssets ? (
              <p className="text-sm text-eq-grey py-4 text-center">
                No E1.25 assets at this site. Ensure assets are assigned to the E1.25 / LVACB plan.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-2 px-3 w-10">
                        <input
                          type="checkbox"
                          checked={assets.length > 0 && assets.every((a) => selectedAssetIds.has(a.id))}
                          onChange={(e) => (e.target.checked ? selectAll() : deselectAll())}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Asset</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Serial</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((asset) => (
                      <tr
                        key={asset.id}
                        className={`border-b border-gray-100 cursor-pointer transition-colors ${
                          selectedAssetIds.has(asset.id) ? 'bg-eq-ice' : 'hover:bg-gray-50'
                        }`}
                        onClick={() => toggleAsset(asset.id)}
                      >
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={selectedAssetIds.has(asset.id)}
                            onChange={() => toggleAsset(asset.id)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="py-2 px-3 font-medium text-eq-ink">{asset.name}</td>
                        <td className="py-2 px-3 text-eq-grey text-xs">{asset.serial_number || '—'}</td>
                        <td className="py-2 px-3 text-eq-grey text-xs">{asset.asset_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {checkError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {checkError}
          </div>
        )}

        {/* Maximo import modal */}
        {showMaximoImport && selectedSite && (
          <AcbMaximoImportModal
            siteId={selectedSite}
            onClose={() => setShowMaximoImport(false)}
            onComplete={() => {
              setShowMaximoImport(false)
              loadSiteData()
            }}
          />
        )}
      </div>
    )
  }

  // ── Home view — checks list ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'ACB Testing' }]} />
          <h2 className="text-3xl font-bold text-eq-ink mt-2">ACB Testing</h2>
          <p className="text-eq-grey text-sm mt-1">Air circuit breaker test checks — E1.25 / LVACB</p>
        </div>
        <Button onClick={() => setShowCreateCheck(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Create Check
        </Button>
      </div>

      <Card>
        {checksLoading ? (
          <div className="p-8 text-center text-eq-grey">Loading…</div>
        ) : checks.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-eq-grey">No ACB checks yet.</p>
            <p className="text-xs text-eq-grey mt-1">
              Create a check to start recording test results.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-4 text-xs font-bold text-eq-grey uppercase">Check</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-eq-grey uppercase">Site</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-eq-grey uppercase">Status</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-eq-grey uppercase">Tests</th>
                  <th className="text-left py-3 px-4 text-xs font-bold text-eq-grey uppercase">Due</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr
                    key={check.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/maintenance/${check.id}`)}
                  >
                    <td className="py-3 px-4 font-medium text-eq-ink">{check.name}</td>
                    <td className="py-3 px-4 text-eq-grey text-sm">{check.site_name}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          STATUS_STYLES[check.status] ?? 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {check.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-eq-grey text-xs">
                      {check.complete_tests}/{check.total_tests} complete
                    </td>
                    <td className="py-3 px-4 text-eq-grey text-xs">
                      {check.due_date
                        ? new Date(check.due_date).toLocaleDateString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <ChevronRight className="w-4 h-4 text-eq-grey inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
