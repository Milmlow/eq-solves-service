import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckDetailPage } from './CheckDetailPage'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { notFound } from 'next/navigation'
import type { Role, MaintenanceCheckItem, Attachment } from '@/lib/types'

export default async function MaintenanceCheckPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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
      .single()
    userRole = (membership?.role as Role) ?? null
  }

  // Fetch the maintenance check
  const { data: check, error } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name)')
    .eq('id', id)
    .single()

  if (error || !check) notFound()

  // Resolve assignee name
  let assigneeName: string | null = null
  if (check.assigned_to) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', check.assigned_to)
      .single()
    assigneeName = profile?.full_name ?? profile?.email ?? null
  }

  // Fetch check_assets with asset details
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location, job_plans(name))')
    .eq('check_id', id)
    .order('created_at')

  // Fetch all check items
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', id)
    .order('sort_order')

  // Fetch attachments
  const { data: attachments } = await supabase
    .from('attachments')
    .select('*')
    .eq('entity_type', 'maintenance_check')
    .eq('entity_id', id)
    .order('created_at')

  const checkName = check.custom_name ?? (check.job_plans as { name: string } | null)?.name ?? 'Maintenance Check'

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: checkName },
        ]} />
        <h1 className="text-2xl font-bold text-eq-sky mt-2">{checkName}</h1>
      </div>
      <CheckDetailPage
        check={{ ...check, assignee_name: assigneeName } as never}
        items={(allItems ?? []) as MaintenanceCheckItem[]}
        checkAssets={(checkAssets ?? []) as never}
        attachments={(attachments ?? []) as Attachment[]}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
        isAssigned={check.assigned_to === user?.id}
      />
    </div>
  )
}
