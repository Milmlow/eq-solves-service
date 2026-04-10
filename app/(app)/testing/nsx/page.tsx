'use client'

/**
 * NSX Testing Workflow Page — site-based 3-step workflow mirroring ACB.
 * Framework scaffold: loads assets by site, allows creating an NSX test per
 * asset, and opens the 3-step NsxWorkflow component.
 */

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, Clock, Play, ChevronRight } from 'lucide-react'
import type { Asset, NsxTest } from '@/lib/types'
import { createNsxTestAction } from '@/app/(app)/nsx-testing/actions'
import { NsxWorkflow } from './NsxWorkflow'

type SitePick = { id: string; name: string }

export default function NsxTestingPage() {
  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [assets, setAssets] = useState<(Asset & { nsx_test?: NsxTest })[]>([])
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [noAssets, setNoAssets] = useState(false)

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

  // Load NSX-relevant assets for site
  const loadSiteData = useCallback(async () => {
    if (!selectedSite) {
      setAssets([])
      setSelectedAsset(null)
      setNoAssets(false)
      return
    }

    setLoading(true)

    // Find NSX-style job plan — match on name containing 'NSX' or code 'LVNSX'
    const { data: jobPlans } = await supabase
      .from('job_plans')
      .select('id, name, code')
      .eq('is_active', true)

    const nsxPlan = (jobPlans ?? []).find(
      (jp) =>
        (jp.name && jp.name.toUpperCase().includes('NSX')) ||
        jp.code === 'LVNSX' ||
        jp.code === 'MCCB',
    )

    // If no NSX plan exists, fall back to showing all site assets
    let assetQuery = supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('is_active', true)
      .order('name')

    if (nsxPlan) {
      assetQuery = assetQuery.eq('job_plan_id', nsxPlan.id)
    }

    const { data: assetsData } = await assetQuery

    if (!assetsData || assetsData.length === 0) {
      setNoAssets(true)
      setAssets([])
      setLoading(false)
      return
    }

    setNoAssets(false)
    const assetIds = assetsData.map((a) => a.id)

    const { data: testsData } = await supabase
      .from('nsx_tests')
      .select('*')
      .in('asset_id', assetIds)
      .eq('is_active', true)

    const testMap = new Map((testsData ?? []).map((t) => [t.asset_id, t as NsxTest]))

    const combined: (Asset & { nsx_test?: NsxTest })[] = assetsData.map((asset) => ({
      ...(asset as Asset),
      nsx_test: testMap.get(asset.id),
    }))

    setAssets(combined)
    setLoading(false)
  }, [selectedSite, supabase])

  useEffect(() => {
    loadSiteData()
  }, [selectedSite])

  async function handleStartTest(asset: Asset) {
    setCreating(asset.id)
    const fd = new FormData()
    fd.set('asset_id', asset.id)
    fd.set('site_id', selectedSite)
    fd.set('test_date', new Date().toISOString().slice(0, 10))
    fd.set('test_type', 'Routine')

    const result = await createNsxTestAction(fd)
    setCreating(null)
    if (result.success) {
      await loadSiteData()
      setSelectedAsset(asset.id)
    }
  }

  const selectedAssetData = selectedAsset ? assets.find((a) => a.id === selectedAsset) : null
  const selectedTest = selectedAssetData?.nsx_test

  const getStepStatus = (test: NsxTest | undefined, step: 'step1' | 'step2' | 'step3') => {
    if (!test) return 'not-started'
    const status = test[`${step}_status` as keyof NsxTest] as string | undefined
    return status === 'complete' ? 'complete' : status === 'in_progress' ? 'in-progress' : 'not-started'
  }

  const getOverallProgress = (test: NsxTest | undefined) => {
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

  // Workflow view
  if (selectedAsset && selectedTest) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'NSX Testing', href: '#' },
              { label: selectedAssetData?.name ?? 'Asset' },
            ]}
          />
          <h1 className="text-3xl font-bold text-eq-sky mt-2">{selectedAssetData?.name}</h1>
          <p className="text-eq-grey text-sm mt-1">3-step NSX testing workflow (framework)</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setSelectedAsset(null)}>
          Back to Asset List
        </Button>
        <NsxWorkflow test={selectedTest} onUpdate={loadSiteData} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-eq-ink">NSX Testing Workflow</h2>
        <p className="text-eq-grey text-sm mt-1">Site-based NSX / MCCB testing — framework mirroring ACB.</p>
      </div>

      {/* Site Selector */}
      <Card className="p-4">
        <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Select Site</label>
        <select
          value={selectedSite}
          onChange={(e) => {
            setSelectedSite(e.target.value)
            setSelectedAsset(null)
          }}
          className="w-full h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        >
          <option value="">Choose a site...</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Card>

      {selectedSite && !loading && noAssets && (
        <Card className="p-8 text-center">
          <p className="text-eq-grey">No NSX assets found for this site.</p>
          <p className="text-xs text-eq-grey mt-1">Ensure assets are assigned to an NSX / MCCB job plan.</p>
        </Card>
      )}

      {selectedSite && !noAssets && (
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-eq-grey">Loading...</div>
          ) : (
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
                  {assets.map((asset) => {
                    const test = asset.nsx_test
                    const progress = getOverallProgress(test)
                    return (
                      <tr key={asset.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-medium text-eq-ink">{asset.name}</p>
                          {asset.serial_number && (
                            <p className="text-xs text-eq-grey">{asset.serial_number}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-eq-grey text-xs">{asset.asset_type}</td>
                        <td className="py-3 px-4 text-center">{statusBadge('Collection', getStepStatus(test, 'step1'))}</td>
                        <td className="py-3 px-4 text-center">{statusBadge('V&F', getStepStatus(test, 'step2'))}</td>
                        <td className="py-3 px-4 text-center">{statusBadge('Electrical', getStepStatus(test, 'step3'))}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  progress === 100 ? 'bg-green-500' : progress > 0 ? 'bg-eq-sky' : 'bg-gray-200'
                                }`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-eq-grey w-8 text-right">{progress}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {test ? (
                            <Button size="sm" onClick={() => setSelectedAsset(asset.id)}>
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
          )}
        </Card>
      )}
    </div>
  )
}
