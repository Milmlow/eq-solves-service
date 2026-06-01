'use client'

/**
 * NSX Testing — home screen shows all NSX checks. Create Check sub-view
 * lets you pick a site (filtered to E-SCH-NSX plan assets), select breakers,
 * set details, and spin up a maintenance_check + nsx_test rows.
 *
 * Tests are worked from /maintenance/[id] (Linked Tests panel → /testing/nsx/[testId]).
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Plus, ChevronRight } from 'lucide-react'
import type { Asset } from '@/lib/types'
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

/** Match any NSX-style maintenance plan — E-SCH-NSX preferred, legacy codes also accepted. */
function isNsxPlan(jp: { name: string | null; code: string | null }) {
  return (
    jp.code === 'E-SCH-NSX' ||
    jp.code === 'LVNSX' ||
    jp.code === 'MCCB' ||
    (jp.name?.toUpperCase().includes('NSX') ?? false)
  )
}

export default function NsxTestingPage() {
  const router = useRouter()
  const supabase = createClient()

  // ── Home view ──────────────────────────────────────────────────────────────
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [checksLoading, setChecksLoading] = useState(true)

  // ── Create Check sub-view ─────────────────────────────────────────────────
  const [showCreateCheck, setShowCreateCheck] = useState(false)
  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
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

  // ── Load checks for home list ──────────────────────────────────────────────
  async function loadChecks() {
    setChecksLoading(true)

    const { data: checksData } = await supabase
      .from('maintenance_checks')
      .select('id, custom_name, status, due_date, site_id')
      .eq('kind', 'nsx')
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
      .from('nsx_tests')
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

  // ── Load NSX-filtered sites (Create Check only) ───────────────────────────
  useEffect(() => {
    if (!showCreateCheck) return
    async function loadNsxSites() {
      const { data: jobPlans } = await supabase
        .from('job_plans')
        .select('id, name, code')
        .eq('is_active', true)

      const nsxPlans = (jobPlans ?? []).filter(isNsxPlan)
      if (nsxPlans.length === 0) { setSites([]); return }

      const { data: assetRows } = await supabase
        .from('assets')
        .select('site_id')
        .in('job_plan_id', nsxPlans.map((p) => p.id))
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
    loadNsxSites()
  }, [showCreateCheck])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load tenant members (Create Check only)
  useEffect(() => {
    if (!showCreateCheck) return
    async function loadMembers() {
      const { data } = await supabase
        .from('tenant_members')
        .select('user_id, role, profiles(id, full_name, email)')
        .eq('is_active', true)
        .in('role', ['super_admin', 'admin', 'supervisor', 'technician'])
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

  // Load assets for selected site (Create Check)
  useEffect(() => {
    if (!selectedSite) { setAssets([]); setNoAssets(false); return }
    async function loadAssets() {
      setAssetsLoading(true)
      const { data: jobPlans } = await supabase
        .from('job_plans')
        .select('id, name, code')
        .eq('is_active', true)

      const nsxPlans = (jobPlans ?? []).filter(isNsxPlan)
      const plan = nsxPlans[0] ?? null
      setJobPlanId(plan?.id ?? null)

      let q = supabase
        .from('assets')
        .select('*')
        .eq('site_id', selectedSite)
        .eq('is_active', true)
        .order('name')
      if (plan) q = q.eq('job_plan_id', plan.id)

      const { data } = await q
      if (!data || data.length === 0) {
        setNoAssets(true)
        setAssets([])
      } else {
        setNoAssets(false)
        setAssets(data as Asset[])
      }
      setAssetsLoading(false)
    }
    loadAssets()
  }, [selectedSite])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateCheck() {
    setCreatingCheck(true)
    setCheckError(null)
    const monthDate = new Date(checkYear, checkMonth - 1, 1).toISOString().slice(0, 10)
    try {
      const result = await createTestingCheckAction({
        site_id: selectedSite,
        job_plan_id: jobPlanId,
        check_type: 'nsx',
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

  // ── Create Check view ──────────────────────────────────────────────────────
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
              { label: 'NSX Testing', href: '/testing/nsx' },
              { label: 'Create Check' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-ink mt-2">Create NSX Check</h2>
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

        {/* Site selector */}
        <Card>
          <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Site</label>
          <select
            value={selectedSite}
            onChange={(e) => {
              setSelectedSite(e.target.value)
              setSelectedAssetIds(new Set())
            }}
            className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Choose a site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
            ))}
          </select>
          {sites.length === 0 && (
            <p className="text-xs text-eq-grey mt-2">
              No sites with NSX (E-SCH-NSX) assets found.
            </p>
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
              placeholder={`${siteName} ${checkFrequency} NSX ${MONTHS[checkMonth - 1]} ${checkYear}`}
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
                No NSX assets at this site. Ensure assets are assigned to the NSX maintenance plan.
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
      </div>
    )
  }

  // ── Home view — checks list ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'NSX Testing' }]} />
          <h2 className="text-3xl font-bold text-eq-ink mt-2">NSX Testing</h2>
          <p className="text-eq-grey text-sm mt-1">NSX / MCCB circuit breaker test checks</p>
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
            <p className="text-eq-grey">No NSX checks yet.</p>
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
