import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { AssetList } from './AssetList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

const PER_PAGE = 25

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; asset_type?: string; job_plan_id?: string; page?: string; show_archived?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const assetType = params.asset_type ?? ''
  const jobPlanId = params.job_plan_id ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'

  const supabase = await createClient()

  // Get current user role
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()
    userRole = (membership?.role as Role) ?? null
  }

  // Fetch sites for filter dropdown
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Fetch distinct asset types
  const { data: typeRows } = await supabase
    .from('assets')
    .select('asset_type')
    .order('asset_type')

  const assetTypes = [...new Set((typeRows ?? []).map((r) => r.asset_type))].filter(Boolean)

  // Build assets query (join job_plans for display)
  let query = supabase
    .from('assets')
    .select('*, sites(name), job_plans(name, code)', { count: 'exact' })
    .order('name')

  if (!showArchived) {
    query = query.eq('is_active', true)
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,asset_type.ilike.%${search}%,serial_number.ilike.%${search}%,maximo_id.ilike.%${search}%,location.ilike.%${search}%`)
  }
  if (siteId) {
    query = query.eq('site_id', siteId)
  }
  if (assetType) {
    query = query.eq('asset_type', assetType)
  }
  if (jobPlanId) {
    query = query.eq('job_plan_id', jobPlanId)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: assets, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Fetch ALL assets for grouped view (no pagination, same filters)
  let allQuery = supabase
    .from('assets')
    .select('*, sites(name), job_plans(name, code)')
    .order('name')
    .limit(2000)

  if (!showArchived) allQuery = allQuery.eq('is_active', true)
  if (search) allQuery = allQuery.or(`name.ilike.%${search}%,asset_type.ilike.%${search}%,serial_number.ilike.%${search}%,maximo_id.ilike.%${search}%,location.ilike.%${search}%`)
  if (siteId) allQuery = allQuery.eq('site_id', siteId)
  if (assetType) allQuery = allQuery.eq('asset_type', assetType)
  if (jobPlanId) allQuery = allQuery.eq('job_plan_id', jobPlanId)

  const { data: allAssets } = await allQuery

  // Fetch all job plans for the form dropdown
  const { data: allJobPlans } = await supabase
    .from('job_plans')
    .select('id, name, code, type')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Assets' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Assets</h1>
      </div>
      <AssetList
        assets={(assets ?? []) as never}
        allAssets={(allAssets ?? []) as never}
        sites={sites ?? []}
        assetTypes={assetTypes}
        allJobPlans={(allJobPlans ?? []) as { id: string; name: string; code: string | null; type: string | null }[]}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
