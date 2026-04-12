import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ContractScopeList } from './ContractScopeList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, ContractScope, Customer, Site } from '@/lib/types'

export default async function ContractScopePage() {
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
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Fetch scope items with joined customer + site names
  const { data: items } = await supabase
    .from('contract_scopes')
    .select('*, customers(name), sites(name)')
    .order('financial_year', { ascending: false })
    .order('scope_item')

  // Fetch customers and sites for dropdowns
  const [customersRes, sitesRes] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('sites').select('id, name, customer_id').eq('is_active', true).order('name'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Contract Scope' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Contract Scope</h1>
        <p className="text-sm text-eq-grey mt-1">Define what work is included or excluded from each customer contract per financial year.</p>
      </div>
      <ContractScopeList
        items={(items ?? []) as (ContractScope & { customers: { name: string } | null; sites: { name: string } | null })[]}
        customers={customersRes.data ?? []}
        sites={(sitesRes.data ?? []) as Pick<Site, 'id' | 'name' | 'customer_id'>[]}
        canWrite={canWrite(userRole)}
        isAdmin={isAdmin(userRole)}
      />
    </div>
  )
}
