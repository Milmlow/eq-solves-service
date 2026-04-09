'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AcbWorkflow } from './AcbWorkflow'
import { AcbSiteCollection } from './AcbSiteCollection'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, Clock, ClipboardList, Play, ChevronRight } from 'lucide-react'
import type { AcbTest, AcbTestReading, Asset } from '@/lib/types'
import { createAcbTestAction } from '@/app/(app)/acb-testing/actions'

type SitePick = { id: string; name: string }
type JobPlanPick = { id: string; name: string; code: string | null; type: string | null }

export default function AcbTestingPage() {
  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [jobPlans, setJobPlans] = useState<JobPlanPick[]>([])
  const [selectedJobPlan, setSelectedJobPlan] = useState<string>('')
  const [assets, setAssets] = useState<(Asset & { acb_test?: AcbTest })[]>([])
  const [readings, setReadings] = useState<Record<string, AcbTestReading[]>>({})
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [showSiteCollection, setShowSiteCollection] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)

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

  // Load job plans when site changes
  useEffect(() => {
    if (!selectedSite) {
      setJobPlans([])
      setSelectedJobPlan('')
      setAssets([])
      setReadings({})
      setSelectedAsset(null)
      return
    }

    async function loadJobPlans() {
      const { data } = await supabase
        .from('job_plans')
        .select('id, name, code, type')
        .eq('site_id', selectedSite)
        .eq('is_active', true)
        .order('name')

      setJobPlans(data ?? [])
      setSelectedJobPlan('')
      setAssets([])
      setReadings({})
      setSelectedAsset(null)
    }
    loadJobPlans()
  }, [selectedSite])

  // Load assets when job plan changes
  const loadAssets = useCallback(async () => {
    if (!selectedSite || !selectedJobPlan) {
      setAssets([])
      setReadings({})
      setSelectedAsset(null)
      return
    }

    setLoading(true)

    // Fetch assets assigned to selected job plan
    const { data: assetsData } = await supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('job_plan_id', selectedJobPlan)
      .eq('is_active', true)
      .order('name')

    const assetIds = (assetsData ?? []).map(a => a.id)
    const testsWithAssets: (Asset & { acb_test?: AcbTest })[] = []

    if (assetIds.length > 0) {
      const { data: testsData } = await supabase
        .from('acb_tests')
        .select('*')
        .in('asset_id', assetIds)
        .eq('is_active', true)

      const testMap = new Map((testsData ?? []).map(t => [t.asset_id, t]))

      for (const asset of assetsData ?? []) {
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
      }
    }

    setAssets(testsWithAssets)
    setLoading(false)
  }, [selectedSite, selectedJobPlan, supabase])

  useEffect(() => {
    loadAssets()
  }, [selectedJobPlan])

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
      await loadAssets()
      setSelectedAsset(asset.id)
    }
  }

  const selectedAssetData = selectedAsset ? assets.find(a => a.id === selectedAsset) : null
  const selectedTest = selectedAssetData?.acb_test
  const selectedPlanData = jobPlans.find(jp => jp.id === selectedJobPlan)

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
          <p className="text-eq-grey text-sm mt-1">
            {selectedPlanData ? `${selectedPlanData.name}${selectedPlanData.code ? ` (${selectedPlanData.code})` : ''}` : 'Site-level'} — breaker identification and settings
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowSiteCollection(false)}>
          Back to Asset List
        </Button>
        <AcbSiteCollection
          assets={assets}
          onUpdate={loadAssets}
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
          onUpdate={loadAssets}
        />
      </div>
    )
  }

  // ── Main asset list view ──
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'ACB Testing' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">ACB Testing Workflow</h1>
        <p className="text-eq-grey text-sm mt-1">Site-based circuit breaker testing</p>
      </div>

      {/* Site + Job Plan Selectors */}
      <Card className="p-4 space-y-3">
        <div>
          <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Select Site</label>
          <select
            value={selectedSite}
            onChange={(e) => {
              setSelectedSite(e.target.value)
              setSelectedAsset(null)
              setShowSiteCollection(false)
            }}
            className="w-full h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Choose a site...</option>
            {sites.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {selectedSite && (
          <div>
            <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Job Plan</label>
            <div className="flex gap-2">
              <select
                value={selectedJobPlan}
                onChange={(e) => {
                  setSelectedJobPlan(e.target.value)
                  setSelectedAsset(null)
                  setShowSiteCollection(false)
                }}
                className="flex-1 h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              >
                <option value="">Choose a job plan...</option>
                {jobPlans.map(jp => (
                  <option key={jp.id} value={jp.id}>
                    {jp.name}{jp.code ? ` (${jp.code})` : ''}{jp.type ? ` — ${jp.type}` : ''}
                  </option>
                ))}
              </select>
              {selectedJobPlan && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowSiteCollection(true)}
                >
                  <ClipboardList className="w-4 h-4 mr-1" />
                  Asset Collection
                </Button>
              )}
            </div>
            {selectedSite && jobPlans.length === 0 && (
              <p className="text-xs text-eq-grey mt-1">No job plans found for this site.</p>
            )}
          </div>
        )}
      </Card>

      {/* Asset Table */}
      {selectedJobPlan && (
        <div className="space-y-2">
          {loading ? (
            <Card className="p-8 text-center text-eq-grey">Loading...</Card>
          ) : assets.length === 0 ? (
            <Card className="p-8 text-center text-eq-grey">
              No assets assigned to this job plan
            </Card>
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
