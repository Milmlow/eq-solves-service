import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { isAdmin as checkIsAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { DerivedScopeWizard } from './DerivedScopeWizard'

/**
 * Reverse-engineering tool: pick a customer that has assets + check
 * history but no contract_scopes, and produce a draft contract scope
 * inferred from what we've actually delivered.
 *
 * Output shape mirrors the structured contract_scopes the importer
 * writes — so once committed (operator review → flip period_status to
 * 'committed') the same downstream flows (CPI escalation, reports,
 * coverage gaps) apply automatically.
 */
export default async function DeriveContractScopePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const role = (membership?.role as Role) ?? null
  if (!checkIsAdmin(role)) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Contract Scope', href: '/contract-scope' },
            { label: 'Derive from work' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Derive Contract Scope from Delivered Work</h1>
        <p className="text-sm text-eq-grey">
          Admin role required. Ask a super_admin or admin to run the derivation.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Contract Scope', href: '/contract-scope' },
            { label: 'Derive from work' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Derive Contract Scope from Delivered Work</h1>
        <p className="text-sm text-eq-grey mt-1">
          For customers without a formal commercial sheet — pick a customer,
          we'll look at their assets and the maintenance checks delivered to
          date, infer a likely scope (frequency × labour × cost), and write
          it as a <span className="font-semibold">draft</span> contract
          scope. Review on <code>/contract-scope</code> before committing,
          and use the result as the starting point for a Statement of Work
          back to the customer.
        </p>
      </div>
      <DerivedScopeWizard />
    </div>
  )
}
