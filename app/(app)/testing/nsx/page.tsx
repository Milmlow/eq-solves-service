import { createClient } from '@/lib/supabase/server'
import { NsxTestList } from '@/app/(app)/nsx-testing/NsxTestList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, NsxTestReading, Attachment } from '@/lib/types'

const PER_PAGE = 25

export default async function NsxTestingPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; overall_result?: string; page?: string; show_archived?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const resultFilter = params.overall_result ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'

  const supabase = await createClient()

  // Current user + role
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

  // Sites for filter + form
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Assets for form dropdown
  const { data: assets } = await supabase
    .from('assets')
    .select('id, name, asset_type, site_id')
    .eq('is_active', true)
    .order('name')

  // Tenant members for tested_by dropdown
  const { data: members } = await supabase
    .from('tenant_members')
    .select('user_id')
    .eq('is_active', true)

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

  // Build NSX tests query
  let query = supabase
    .from('nsx_tests')
    .select('*, assets(name, asset_type), sites(name)', { count: 'exact' })
    .order('test_date', { ascending: false })

  if (!showArchived) query = query.eq('is_active', true)
  if (siteId) query = query.eq('site_id', siteId)
  if (resultFilter) query = query.eq('overall_result', resultFilter)

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: testsRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Resolve tested_by names
  const testerIds = [...new Set((testsRaw ?? []).map((t) => t.tested_by).filter(Boolean))]
  let testerMap: Record<string, string> = {}
  if (testerIds.length > 0) {
    const { data: testerProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', testerIds)
    for (const p of testerProfiles ?? []) {
      testerMap[p.id] = p.full_name ?? p.email
    }
  }

  const tests = (testsRaw ?? []).map((t) => ({
    ...t,
    tester_name: t.tested_by ? (testerMap[t.tested_by] ?? null) : null,
  }))

  // Search filter
  const filteredTests = search
    ? tests.filter((t) => {
        const assetName = (t.assets as { name: string; asset_type: string } | null)?.name ?? ''
        const siteName = (t.sites as { name: string } | null)?.name ?? ''
        const q = search.toLowerCase()
        return (
          assetName.toLowerCase().includes(q) ||
          siteName.toLowerCase().includes(q) ||
          (t.cb_make as string || '').toLowerCase().includes(q) ||
          (t.cb_model as string || '').toLowerCase().includes(q) ||
          (t.test_type as string).toLowerCase().includes(q)
        )
      })
    : tests

  // Fetch readings + attachments
  const testIds = filteredTests.map((t) => t.id)
  let readingsMap: Record<string, NsxTestReading[]> = {}
  let attachmentsMap: Record<string, Attachment[]> = {}
  if (testIds.length > 0) {
    const { data: allReadings } = await supabase
      .from('nsx_test_readings')
      .select('*')
      .in('nsx_test_id', testIds)
      .order('sort_order')

    readingsMap = (allReadings ?? []).reduce((acc, rdg) => {
      const key = rdg.nsx_test_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(rdg as NsxTestReading)
      return acc
    }, {} as Record<string, NsxTestReading[]>)

    const { data: allAttachments } = await supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'nsx_test')
      .in('entity_id', testIds)
      .order('created_at')

    attachmentsMap = (allAttachments ?? []).reduce((acc, att) => {
      const key = att.entity_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(att as Attachment)
      return acc
    }, {} as Record<string, Attachment[]>)
  }

  return (
    <div className="space-y-4">
      <NsxTestList
        tests={filteredTests as never}
        readingsMap={readingsMap}
        attachmentsMap={attachmentsMap}
        assets={(assets ?? []) as never}
        sites={sites ?? []}
        technicians={technicians}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
