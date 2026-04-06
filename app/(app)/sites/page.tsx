import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { SiteList } from './SiteList'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'

const PER_PAGE = 25

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; customer_id?: string; page?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const customerId = params.customer_id ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

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

  // Fetch customers for filter dropdown
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Build sites query with joined customer name + asset count
  let query = supabase
    .from('sites')
    .select('*, customers(name), assets(count)', { count: 'exact' })
    .order('name')

  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
  }
  if (customerId) {
    query = query.eq('customer_id', customerId)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: sitesRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Map asset count from the aggregation
  const sites = (sitesRaw ?? []).map((s) => {
    const assetAgg = s.assets as unknown as { count: number }[] | null
    return {
      ...s,
      assets: undefined,
      asset_count: assetAgg?.[0]?.count ?? 0,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Sites' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Sites</h1>
      </div>
      <SiteList
        sites={sites as never}
        customers={customers ?? []}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
      />
    </div>
  )
}
