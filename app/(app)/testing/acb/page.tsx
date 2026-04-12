'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AcbWorkflow } from './AcbWorkflow'
import { AcbSiteCollection } from './AcbSiteCollection'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, Clock, ClipboardList, Play, ChevronRight, Download, Upload, Plus } from 'lucide-react'
import type { AcbTest, AcbTestReading, Asset } from '@/lib/types'
import { createAcbTestAction, updateAcbDetailsAction } from '@/app/(app)/acb-testing/actions'
import { exportAcbCollectionXlsx, parseAcbCollectionXlsx } from '@/lib/utils/acb-excel'
import { createTestingCheckAction } from '@/app/(app)/testing/check-actions'

type SitePick = { id: string; name: string }

const FREQUENCIES = ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly'] as const
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export default function AcbTestingPage() {
  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [assets, setAssets] = useState<(Asset & { acb_test?: AcbTest })[]>([])
  const [readings, setReadings] = useState<Record<string, AcbTestReading[]>>({})
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [showSiteCollection, setShowSiteCollection] = useState(false)
  const [showCreateCheck, setShowCreateCheck] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [noAssets, setNoAssets] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: number } | null>(null)
  // Create Check form state
  const [checkFrequency, setCheckFrequency] = useState<string>('Annual')
  const [checkMonth, setCheckMonth] = useState<number>(new Date().getMonth() + 1)
  const [checkYear, setCheckYear] = useState<number>(new Date().getFullYear())
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [creatingCheck, setCreatingCheck] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [jobPlanId, setJobPlanId] = useState<string | null>(null)

  const supabase = createClient()

  // Load sites
  useEffect(() => {
    async function loadSites() {
      const { data } = await supabase
        .from('sites')
        .select('id, name')
        .eq('is_active', true)
        .order('name')

      setSites(data ?? [])
    }
    loadSites()
  }, [])

  // Load E1.25 assets when site changes
  const loadSiteData = useCallback(async () => {
    if (!selectedSite) {
      setAssets([])
      setReadings({})
      setSelectedAsset(null)
      setNoAssets(false)
      return
    }

    setLoading(true)

    // Find the E1.25 / LVACB job plan (global — site_id may be null)
    const { data: jobPlans } = await supabase
      .from('job_plans')
      .select('id, name, code')
      .eq('is_active', true)

    const e125Plan = (jobPlans ?? []).find(
      (jp) => jp.name === 'E1.25' || jp.code === 'LVACB'
    )

    if (!e125Plan) {
      setNoAssets(true)
      setAssets([])
      setReadings({})
      setJobPlanId(null)
      setLoading(false)
      return
    }

    setJobPlanId(e125Plan.id)

    // Fetch assets for this site assigned to E1.25
    const { data: assetsData } = await supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('job_plan_id', e125Plan.id)
      .eq('is_active', true)
      .order('name')

    if (!assetsData || assetsData.length === 0) {
      setNoAssets(true)
      setAssets([])
      setReadings({})
      setLoading(false)
      return
    }

    setNoAssets(false)
    const assetIds = assetsData.map(a => a.id)
    const testsWithAssets: (Asset & { acb_test?: AcbTest })[] = []

    const { data: testsData } = await supabase
      .from('acb_tests')
      .select('*')
      .in('asset_id', assetIds)
      .eq('is_active', true)

    const testMap = new Map((testsData ?? []).map(t => [t.asset_id, t]))

    for (const asset of assetsData) {
      testsWithAssets.push({
        ...asset,
        acb_test: testMap.get(asset.id),
      })
    }

    // Fetch readings
    const testIds = (testsData ?? []).map(t => t.id)
    if (testIds.length > 0) {
      const { data: readingsData } = await supabase
        .from('acb_test_readings')
        .select('*')
        .in('acb_test_id', testIds)
        .order('sort_order')

      const readingsMap: Record<string, AcbTestReading[]> = {}
      for (const rdg of readingsData ?? []) {
        const key = rdg.acb_test_id as string
        if (!readingsMap[key]) readingsMap[key] = []
        readingsMap[key].push(rdg as AcbTestReading)
      }
      setReadings(readingsMap)
    } else {
      setReadings({})
    }

    setAssets(testsWithAssets)
    setLoading(false)
  }, [selectedSite, supabase])

  useEffect(() => {
    loadSiteData()
  }, [selectedSite])

  // Create test and open workflow
  async function handleStartTest(asset: Asset) {
    setCreating(asset.id)
    const fd = new FormData()
    fd.set('asset_id', asset.id)
    fd.set('site_id', selectedSite)
    fd.set('test_date', new Date().toISOString().slice(0, 10))
    fd.set('test_type', 'Routine')

    const result = await createAcbTestAction(fd)
    setCreating(null)
    if (result.success) {
      await loadSiteData()
      setSelectedAsset(asset.id)
    }
  }

  // Excel export
  function handleExport() {
    const siteName = sites.find(s => s.id === selectedSite)?.name ?? 'Site'
    exportAcbCollectionXlsx(siteName, assets)
  }

  // Excel import
  async function handleImport(file: File) {
    setImporting(true)
    setImportResult(null)
    try {
      const rows = await parseAcbCollectionXlsx(file)
      let success = 0
      let errors = 0
      for (const row of rows) {
        if (!row.test_id) { errors++; continue }
        const { asset_id: _a, test_id: _t, ...data } = row
        const result = await updateAcbDetailsAction(row.test_id, {
          ...data,
          step1_status: 'complete',
        } as Parameters<typeof updateAcbDetailsAction>[1])
        if (result.success) success++
        else errors++
      }
      setImportResult({ success, errors })
      await loadSiteData()
    } catch {
      setImportResult({ success: 0, errors: 1 })
    }
    setImporting(false)
  }

  // Create Check handler
  async function handleCreateCheck() {
    setCreatingCheck(true)
    setCheckError(null)
    try {
      const result = await createTestingCheckAction({
        site_id: selectedSite,
        job_plan_id: jobPlanId,
        check_type: 'acb',
        frequency: checkFrequency,
        month: checkMonth,
        year: checkYear,
        asset_ids: Array.from(selectedAssetIds),
      })
      if (result.success) {
        setShowCreateCheck(false)
        setSelectedAssetIds(new Set())
        await loadSiteData()
      } else {
        setCheckError(result.error ?? 'Failed to create check.')
      }
    } catch {
      setCheckError('An unexpected error occurred.')
    }
    setCreatingCheck(false)
  }

  // Toggle asset selection for check
  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  function selectAllAssets() {
    // Only select untested assets
    const untested = assets.filter(a => !a.acb_test).map(a => a.id)
    setSelectedAssetIds(new Set(untested))
  }

  function deselectAllAssets() {
    setSelectedAssetIds(new Set())
  }

  const selectedAssetData = selectedAsset ? assets.find(a => a.id === selectedAsset) : null
  const selectedTest = selectedAssetData?.acb_test

  // Progress helpers
  const getStepStatus = (test: AcbTest | undefined, step: 'step1' | 'step2' | 'step3') => {
    if (!test) return 'not-started'
    const status = test[`${step}_status` as keyof AcbTest] as string
    return status === 'complete' ? 'complete' : status === 'in_progress' ? 'in-progress' : 'not-started'
  }

  const getOverallProgress = (test: AcbTest | undefined) => {
    if (!test) return 0
    let done = 0
    if (test.step1_status === 'complete') done++
    if (test.step2_status === 'complete') done++
    if (test.step3_status === 'complete') done++
    return Math.round((done / 3) * 100)
  }

  const statusBadge = (label: string, status: string) => {
    const colors =
      status === 'complete'
        ? 'bg-green-100 text-green-700'
        : status === 'in-progress'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-gray-100 text-gray-500'
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
        {status === 'complete' ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : status === 'in-progress' ? (
          <Clock className="w-3 h-3" />
        ) : (
          <div className="w-2 h-2 border border-current rounded-full" />
        )}
        {label}
      </span>
    )
  }

  // ── Site Collection view ──
  if (showSiteCollection && selectedSite) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '#' },
              { label: 'Asset Collection' },
            ]}
          />
          <h1 className="text-3xl font-bold text-eq-sky mt-2">ACB Asset Collection</h1>
          <p className="text-eq-grey text-sm mt-1">Site-level breaker identification and settings</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowSiteCollection(false)}>
          Back to Asset List
        </Button>
        <AcbSiteCollection
          assets={assets}
          onUpdate={loadSiteData}
        />
      </div>
    )
  }

  // ── Workflow view (per-asset) ──
  if (selectedAsset && selectedTest) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '#' },
              { label: selectedAssetData?.name ?? 'Asset' },
            ]}
          />
          <h1 className="text-3xl font-bold text-eq-sky mt-2">{selectedAssetData?.name}</h1>
          <p className="text-eq-grey text-sm mt-1">3-step testing workflow</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setSelectedAsset(null)}>
          Back to Asset List
        </Button>
        <AcbWorkflow
          test={selectedTest}
          readings={readings[selectedTest.id] ?? []}
          onUpdate={loadSiteData}
        />
      </div>
    )
  }

  // ── Create Check view ──
  if (showCreateCheck && selectedSite) {
    const untestedAssets = assets.filter(a => !a.acb_test)
    const testedAssets = assets.filter(a => !!a.acb_test)
    const siteName = sites.find(s => s.id === selectedSite)?.name ?? 'Site'

    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '#' },
              { label: 'Create Check' },
            ]}
          />
          <h1 className="text-3xl font-bold text-eq-sky mt-2">Create ACB Check</h1>
          <p className="text-eq-grey text-sm mt-1">Group assets under a named maintenance check for {siteName}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowCreateCheck(false)}>
          Back to Asset List
        </Button>

        {/* Check Details */}
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
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
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
                {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 p-3 bg-eq-ice rounded-md">
            <p className="text-xs text-eq-grey">Check name preview:</p>
            <p className="text-sm font-semibold text-eq-ink">
              {siteName} {checkFrequency} {jobPlanId ? 'E1.25' : ''} {MONTHS[checkMonth - 1]} {checkYear}
            </p>
          </div>
        </Card>

        {/* Asset Selection */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-eq-ink">Select Assets</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={selectAllAssets}>
                Select All Untested
              </Button>
              <Button size="sm" variant="secondary" onClick={deselectAllAssets}>
                Deselect All
              </Button>
            </div>
          </div>
          {untestedAssets.length === 0 && testedAssets.length > 0 && (
            <p className="text-sm text-eq-grey mb-3">All assets at this site already have active tests.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-2 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={untestedAssets.length > 0 && untestedAssets.every(a => selectedAssetIds.has(a.id))}
                      onChange={(e) => e.target.checked ? selectAllAssets() : deselectAllAssets()}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Asset</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Serial</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {untestedAssets.map(asset => (
                  <tr
                    key={asset.id}
                    className={`border-b border-gray-100 cursor-pointer transition-colors ${selectedAssetIds.has(asset.id) ? 'bg-eq-ice' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleAssetSelection(asset.id)}
                  >
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selectedAssetIds.has(asset.id)}
                        onChange={() => toggleAssetSelection(asset.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-eq-ink">{asset.name}</td>
                    <td className="py-2 px-3 text-eq-grey text-xs">{asset.serial_number || '-'}</td>
                    <td className="py-2 px-3 text-eq-grey text-xs">{asset.asset_type}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">Available</span>
                    </td>
                  </tr>
                ))}
                {testedAssets.map(asset => (
                  <tr key={asset.id} className="border-b border-gray-100 opacity-50">
                    <td className="py-2 px-3">
                      <input type="checkbox" disabled className="rounded border-gray-300" />
                    </td>
                    <td className="py-2 px-3 font-medium text-eq-grey">{asset.name}</td>
                    <td className="py-2 px-3 text-eq-grey text-xs">{asset.serial_number || '-'}</td>
                    <td className="py-2 px-3 text-eq-grey text-xs">{asset.asset_type}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-600">Test Exists</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Create Button */}
        {checkError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{checkError}</div>
        )}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleCreateCheck}
            disabled={creatingCheck || selectedAssetIds.size === 0}
          >
            {creatingCheck ? 'Creating...' : `Create Check (${selectedAssetIds.size} assets)`}
          </Button>
          <Button variant="secondary" onClick={() => setShowCreateCheck(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // ── Main asset list view ──
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'ACB Testing' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">ACB Testing Workflow</h1>
        <p className="text-eq-grey text-sm mt-1">Site-based circuit breaker testing — E1.25 (LVACB) assets</p>
      </div>

      {/* Site Selector */}
      <Card className="p-4">
        <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Select Site</label>
        <div className="flex gap-2">
          <select
            value={selectedSite}
            onChange={(e) => {
              setSelectedSite(e.target.value)
              setSelectedAsset(null)
              setShowSiteCollection(false)
            }}
            className="flex-1 h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Choose a site...</option>
            {sites.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
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
                {importing ? 'Importing...' : 'Import'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleExport}
              >
                <Download className="w-4 h-4 mr-1" />
                Export
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowSiteCollection(true)}
              >
                <ClipboardList className="w-4 h-4 mr-1" />
                Breaker Details
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowCreateCheck(true)
                  setSelectedAssetIds(new Set())
                  setCheckError(null)
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Check
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
          <div className={`mt-2 p-2 rounded-md text-sm ${
            importResult.errors > 0
              ? 'bg-amber-50 border border-amber-200 text-amber-700'
              : 'bg-green-50 border border-green-200 text-green-700'
          }`}>
            Import complete: {importResult.success} updated{importResult.errors > 0 ? `, ${importResult.errors} failed` : ''}
          </div>
        )}
      </Card>

      {/* No E1.25 assets message */}
      {selectedSite && !loading && noAssets && (
        <Card className="p-8 text-center">
          <p className="text-eq-grey">No E1.25 (LVACB) assets found for this site.</p>
          <p className="text-xs text-eq-grey mt-1">
            Ensure assets are assigned to the E1.25 job plan.
          </p>
        </Card>
      )}

      {/* Asset Table */}
      {selectedSite && !noAssets && (
        <div className="space-y-2">
          {loading ? (
            <Card className="p-8 text-center text-eq-grey">Loading...</Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Asset</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Type</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Asset Collection</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Visual &amp; Functional</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Electrical</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Progress</th>
                      <th className="text-right py-3 px-4 font-medium text-eq-grey">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map(asset => {
                      const test = asset.acb_test
                      const progress = getOverallProgress(test)
                      return (
                        <tr
                          key={asset.id}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-medium text-eq-ink">{asset.name}</p>
                              {asset.serial_number && (
                                <p className="text-xs text-eq-grey">{asset.serial_number}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-eq-grey text-xs">{asset.asset_type}</td>
                          <td className="py-3 px-4 text-center">
                            {statusBadge('Collection', getStepStatus(test, 'step1'))}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {statusBadge('V&F', getStepStatus(test, 'step2'))}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {statusBadge('Electrical', getStepStatus(test, 'step3'))}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    progress === 100
                                      ? 'bg-green-500'
                                      : progress > 0
                                      ? 'bg-eq-sky'
                                      : 'bg-gray-200'
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-eq-grey w-8 text-right">{progress}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {test ? (
                              <Button
                                size="sm"
                                onClick={() => setSelectedAsset(asset.id)}
                              >
                                Continue
                                <ChevronRight className="w-3 h-3 ml-1" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleStartTest(asset)}
                                disabled={creating === asset.id}
                              >
                                {creating === asset.id ? (
                                  'Creating...'
                                ) : (
                                  <>
                                    <Play className="w-3 h-3 mr-1" />
                                    Start Test
                                  </>
                                )}
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
