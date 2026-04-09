'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AcbWorkflow } from './AcbWorkflow'
import { AcbBulkDetails } from './AcbBulkDetails'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import type { AcbTest, AcbTestReading, Asset } from '@/lib/types'

type SitePick = { id: string; name: string }

interface TestWithRelations extends AcbTest {
  assets?: { name: string; asset_type: string } | null
  sites?: { name: string } | null
}

export default function AcbTestingPage() {
  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [assets, setAssets] = useState<(Asset & { acb_test?: AcbTest })[]>([])
  const [tests, setTests] = useState<TestWithRelations[]>([])
  const [readings, setReadings] = useState<Record<string, AcbTestReading[]>>({})
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'bulk'>('list')
  const [loading, setLoading] = useState(false)

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

  // Load assets and tests when site changes
  useEffect(() => {
    if (!selectedSite) {
      setAssets([])
      setTests([])
      setReadings({})
      setSelectedAsset(null)
      return
    }

    loadSiteData()
  }, [selectedSite])

  async function loadSiteData() {
    setLoading(true)

    // Fetch assets for site
    const { data: assetsData } = await supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('is_active', true)
      .order('name')

    // Fetch ACB tests for these assets
    const assetIds = (assetsData ?? []).map(a => a.id)
    const testsWithAssets: (Asset & { acb_test?: AcbTest })[] = []

    if (assetIds.length > 0) {
      const { data: testsData } = await supabase
        .from('acb_tests')
        .select('*')
        .in('asset_id', assetIds)
        .eq('is_active', true)

      const testMap = new Map(testsData?.map(t => [t.asset_id, t]) ?? [])

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
          const key = (rdg.acb_test_id as string)
          if (!readingsMap[key]) readingsMap[key] = []
          readingsMap[key].push(rdg as AcbTestReading)
        }
        setReadings(readingsMap)
      }
    }

    setAssets(testsWithAssets)
    setLoading(false)
  }

  const selectedAssetData = selectedAsset ? assets.find(a => a.id === selectedAsset) : null
  const selectedTest = selectedAssetData?.acb_test

  const getStepStatus = (test: AcbTest | undefined, step: 'step1' | 'step2' | 'step3') => {
    if (!test) return 'not-started'
    const status = test[`${step}_status` as keyof AcbTest] as string
    return status === 'complete' ? 'complete' : status === 'in_progress' ? 'in-progress' : 'not-started'
  }

  const statusIcon = (status: string) => {
    if (status === 'complete') return <CheckCircle2 className="w-4 h-4 text-green-600" />
    if (status === 'in-progress') return <Clock className="w-4 h-4 text-amber-500" />
    return <div className="w-3 h-3 border-2 border-gray-300 rounded-full" />
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'ACB Testing' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">ACB Testing Workflow</h1>
        <p className="text-eq-grey text-sm mt-1">Site-based 3-step circuit breaker testing process</p>
      </div>

      {/* Site Selector */}
      <Card className="p-4">
        <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Select Site</label>
        <div className="flex gap-2">
          <select
            value={selectedSite}
            onChange={(e) => setSelectedSite(e.target.value)}
            className="flex-1 h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Choose a site...</option>
            {sites.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {selectedSite && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                onClick={() => setViewMode('list')}
              >
                View Details
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'bulk' ? 'primary' : 'secondary'}
                onClick={() => setViewMode('bulk')}
              >
                Bulk Edit
              </Button>
            </div>
          )}
        </div>
      </Card>

      {selectedSite && !selectedAsset && viewMode === 'list' && (
        /* Asset list view */
        <div className="space-y-2">
          {loading ? (
            <Card className="p-8 text-center text-eq-grey">Loading...</Card>
          ) : assets.length === 0 ? (
            <Card className="p-8 text-center text-eq-grey">No assets found for this site</Card>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Asset</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">CB Make</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">CB Model</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">CB Serial</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Rating</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Step 1</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Step 2</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Step 3</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map(asset => {
                      const test = asset.acb_test
                      return (
                        <tr key={asset.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedAsset(asset.id)}>
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-medium text-eq-ink">{asset.name}</p>
                              {asset.maximo_id && (
                                <p className="text-xs text-eq-grey">{asset.maximo_id}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-eq-grey">{test?.cb_make || '—'}</td>
                          <td className="py-3 px-4 text-eq-grey">{test?.cb_model || '—'}</td>
                          <td className="py-3 px-4 text-eq-grey text-xs font-mono">{test?.cb_serial || '—'}</td>
                          <td className="py-3 px-4 text-eq-grey">{test?.cb_rating || '—'}</td>
                          <td className="py-3 px-4 text-center">{test ? statusIcon(getStepStatus(test, 'step1')) : '—'}</td>
                          <td className="py-3 px-4 text-center">{test ? statusIcon(getStepStatus(test, 'step2')) : '—'}</td>
                          <td className="py-3 px-4 text-center">{test ? statusIcon(getStepStatus(test, 'step3')) : '—'}</td>
                          <td className="py-3 px-4">
                            <Button size="sm" onClick={(e) => { e.stopPropagation(); setSelectedAsset(asset.id) }}>
                              Open
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {selectedSite && viewMode === 'bulk' && (
        <AcbBulkDetails assets={assets} onUpdate={loadSiteData} />
      )}

      {selectedAsset && selectedTest && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setSelectedAsset(null)} className="mb-4">
            Back to List
          </Button>
          <AcbWorkflow test={selectedTest} readings={readings[selectedTest.id] ?? []} onUpdate={loadSiteData} />
        </div>
      )}
    </div>
  )
}
