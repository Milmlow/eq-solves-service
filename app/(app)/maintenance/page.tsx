import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { MaintenanceList } from './MaintenanceList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, MaintenanceCheckItem } from '@/lib/types'

const PER_PAGE = 25

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; status?: string; kind?: string; page?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const status = params.status ?? ''
  const kind = params.kind ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

  const supabase = await createClient()

  // Get current user + role
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Fetch sites for filter (include customer_id for scope lookup, customer
  // name to disambiguate duplicate site codes across customers)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, code, customer_id, customers(name)')
    .eq('is_active', true)
    .order('name')

  // Fetch active job plans for create form
  const { data: jobPlans } = await supabase
    .from('job_plans')
    .select('id, name, code')
    .eq('is_active', true)
    .order('name')

  // Fetch tenant members for assignment dropdown (all active members)
  const { data: members } = await supabase
    .from('tenant_members')
    .select('user_id')
    .eq('is_active', true)

  // Fetch profiles for those members
  const memberIds = (members ?? []).map((m) => m.user_id)
  let technicians: { id: string; email: string; full_name: string | null }[] = []
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', memberIds)
      .eq('is_active', true)
      .order('full_name')
    technicians = (profiles ?? []) as typeof technicians
  }

  // Fetch contract scope items for current FY (for scope indicator on check creation)
  const now = new Date()
  const fyYear = now.getMonth() + 1 < 7 ? now.getFullYear() - 1 : now.getFullYear()
  const currentFY = `${fyYear}-${fyYear + 1}`
  const { data: scopeItems } = await supabase
    .from('contract_scopes')
    .select('id, customer_id, site_id, scope_item, is_included, notes, financial_year')
    .eq('financial_year', currentFY)

  // Build checks query — hide archived (is_active=false) by default
  let query = supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name), maintenance_check_items(count)', { count: 'exact' })
    .eq('is_active', true)
    .order('due_date', { ascending: true })

  if (search) {
    // Search by job plan name — need to filter after fetch or use a join. For now, fetch all.
    // We'll filter client-side for search since it's across a join.
  }
  if (siteId) {
    query = query.eq('site_id', siteId)
  }
  if (status) {
    query = query.eq('status', status)
  }
  if (kind) {
    // Server-side kind filter — wired to the new "Type" dropdown on the
    // maintenance list (2026-04-28 chrome polish).
    query = query.eq('kind', kind)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: checksRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Map item counts and resolve assignee names
  const assigneeIds = [...new Set((checksRaw ?? []).map((c) => c.assigned_to).filter(Boolean))]
  let assigneeMap: Record<string, string> = {}
  if (assigneeIds.length > 0) {
    const { data: assigneeProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', assigneeIds)
    for (const p of assigneeProfiles ?? []) {
      assigneeMap[p.id] = p.full_name ?? p.email
    }
  }

  const checks = (checksRaw ?? []).map((c) => {
    const itemAgg = c.maintenance_check_items as unknown as { count: number }[] | null
    const itemCount = itemAgg?.[0]?.count ?? 0
    return {
      ...c,
      maintenance_check_items: undefined,
      item_count: itemCount,
      completed_count: 0, // Will be calculated below
      assignee_name: c.assigned_to ? (assigneeMap[c.assigned_to] ?? null) : null,
    }
  })

  // Fetch all check items for visible checks (for completed counts + kanban)
  const checkIds = checks.map((c) => c.id)
  let itemsMap: Record<string, MaintenanceCheckItem[]> = {}
  if (checkIds.length > 0) {
    const { data: allItems } = await supabase
      .from('maintenance_check_items')
      .select('*')
      .in('check_id', checkIds)
      .order('sort_order')
      .limit(10000)

    itemsMap = (allItems ?? []).reduce((acc, item) => {
      const key = item.check_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(item as MaintenanceCheckItem)
      return acc
    }, {} as Record<string, MaintenanceCheckItem[]>)

    // Update completed counts
    for (const c of checks) {
      const items = itemsMap[c.id] ?? []
      c.completed_count = items.filter((i) => i.result !== null).length
    }
  }

  // Filter by search (across job plan name) — client-side fallback
  const filteredChecks = search
    ? checks.filter((c) => {
        const jpName = (c.job_plans as { name: string } | null)?.name ?? ''
        const siteName = (c.sites as { name: string } | null)?.name ?? ''
        const q = search.toLowerCase()
        return jpName.toLowerCase().includes(q) || siteName.toLowerCase().includes(q)
      })
    : checks

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Maintenance' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Maintenance Checks</h1>
      </div>
      <MaintenanceList
        checks={filteredChecks as never}
        itemsMap={itemsMap}
        jobPlans={(jobPlans ?? []) as never}
        sites={sites ?? []}
        technicians={technicians}
        scopeItems={(scopeItems ?? []) as never}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
