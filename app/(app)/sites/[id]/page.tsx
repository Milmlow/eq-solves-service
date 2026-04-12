import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DataTable } from '@/components/ui/DataTable'
import { formatDate, formatCheckStatus, formatTestResult } from '@/lib/utils/format'
import { isAdmin as checkIsAdmin } from '@/lib/utils/roles'
import type { Site, Asset, MaintenanceCheck, TestRecord, SiteContact, Role } from '@/lib/types'
import { SiteContacts } from './SiteContacts'

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Get current user role
  const { data: { user } } = await supabase.auth.getUser()
  let userIsAdmin = false
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userIsAdmin = checkIsAdmin((membership?.role as Role) ?? null)
  }

  // Fetch site with customer info
  const { data: siteRaw } = await supabase
    .from('sites')
    .select('*, customers(name)')
    .eq('id', id)
    .maybeSingle()

  if (!siteRaw) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Sites', href: '/sites' }, { label: 'Not Found' }]} />
        <div className="text-center text-eq-grey">
          <p>Site not found.</p>
        </div>
      </div>
    )
  }

  const site = siteRaw as Site & { customers: { name: string } | null }

  // Fetch counts and data in parallel
  const [
    assetsRes,
    activeChecksRes,
    completedChecksRes,
    testRecordsRes,
    recentAssetsRes,
    recentChecksRes,
    recentTestsRes,
    contactsRes,
  ] = await Promise.all([
    // Asset count
    supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('is_active', true),
    // Active maintenance checks count
    supabase
      .from('maintenance_checks')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .neq('status', 'complete'),
    // Completed maintenance checks count
    supabase
      .from('maintenance_checks')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('status', 'complete'),
    // Test records count
    supabase
      .from('test_records')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', id)
      .eq('is_active', true),
    // Recent assets (top 10)
    supabase
      .from('assets')
      .select('*')
      .eq('site_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10),
    // Recent maintenance checks (top 5)
    supabase
      .from('maintenance_checks')
      .select('*, job_plans(name)')
      .eq('site_id', id)
      .order('updated_at', { ascending: false })
      .limit(5),
    // Recent test records (top 5)
    supabase
      .from('test_records')
      .select('*')
      .eq('site_id', id)
      .eq('is_active', true)
      .order('test_date', { ascending: false })
      .limit(5),
    // Site contacts
    supabase
      .from('site_contacts')
      .select('*')
      .eq('site_id', id)
      .order('is_primary', { ascending: false })
      .order('name'),
  ])

  const assetCount = assetsRes.count ?? 0
  const activeChecksCount = activeChecksRes.count ?? 0
  const completedChecksCount = completedChecksRes.count ?? 0
  const testRecordsCount = testRecordsRes.count ?? 0

  const recentAssets = (recentAssetsRes.data ?? []) as Asset[]
  const recentChecks = (recentChecksRes.data ?? []) as (MaintenanceCheck & { job_plans: { name: string } | null })[]
  const recentTests = (recentTestsRes.data ?? []) as TestRecord[]
  const contacts = (contactsRes.data ?? []) as SiteContact[]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Sites', href: '/sites' },
          { label: site.name },
        ]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">{site.name}</h1>
      </div>

      {/* Site Info Header */}
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Code</p>
            <p className="text-sm font-medium text-eq-ink">{site.code || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Customer</p>
            <p className="text-sm font-medium text-eq-ink">{site.customers?.name || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Status</p>
            <div className="mt-1">
              <StatusBadge status={site.is_active ? 'active' : 'inactive'} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Created</p>
            <p className="text-sm font-medium text-eq-ink">{formatDate(site.created_at)}</p>
          </div>
        </div>
        {site.address && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Address</p>
            <p className="text-sm text-eq-ink">
              {site.address}
              {site.city && `, ${site.city}`}
              {site.state && `, ${site.state}`}
              {site.postcode && ` ${site.postcode}`}
              {site.country && `, ${site.country}`}
            </p>
          </div>
        )}
      </Card>

      {/* Site Contacts */}
      <SiteContacts siteId={id} contacts={contacts} isAdmin={userIsAdmin} />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Assets</p>
          <p className="text-3xl font-bold text-eq-ink">{assetCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Active Checks</p>
          <p className="text-3xl font-bold text-eq-sky">{activeChecksCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Completed Checks</p>
          <p className="text-3xl font-bold text-green-600">{completedChecksCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Test Records</p>
          <p className="text-3xl font-bold text-eq-deep">{testRecordsCount}</p>
        </Card>
      </div>

      {/* Recent Assets Table */}
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Recent Assets</h2>
        <DataTable<Asset & Record<string, unknown>>
          columns={[
            {
              key: 'name',
              header: 'Asset Name',
              render: (row) => (
                <a href={`/assets/${row.id}`} className="text-eq-sky hover:text-eq-deep font-medium">
                  {row.name}
                </a>
              ),
            },
            {
              key: 'asset_type',
              header: 'Type',
            },
            {
              key: 'manufacturer',
              header: 'Manufacturer',
              render: (row) => row.manufacturer || '-',
            },
            {
              key: 'model',
              header: 'Model',
              render: (row) => row.model || '-',
            },
            {
              key: 'serial_number',
              header: 'Serial Number',
              render: (row) => row.serial_number || '-',
            },
          ]}
          rows={recentAssets as (Asset & Record<string, unknown>)[]}
          emptyMessage="No assets found for this site."
        />
      </div>

      {/* Recent Maintenance Checks Table */}
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Recent Maintenance Checks</h2>
        <DataTable<MaintenanceCheck & { job_plans: { name: string } | null } & Record<string, unknown>>
          columns={[
            {
              key: 'job_plans',
              header: 'Job Plan',
              render: (row) => (
                <a
                  href={`/job-plans/${row.job_plans?.name}`}
                  className="text-eq-sky hover:text-eq-deep font-medium"
                >
                  {row.job_plans?.name || '-'}
                </a>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => {
                const statusMap: Record<string, 'not-started' | 'in-progress' | 'complete' | 'cancelled' | 'overdue'> = {
                  scheduled: 'not-started', in_progress: 'in-progress', complete: 'complete', cancelled: 'cancelled', overdue: 'overdue',
                }
                return (
                  <StatusBadge
                    status={statusMap[row.status] ?? 'not-started'}
                    label={formatCheckStatus(row.status)}
                  />
                )
              },
            },
            {
              key: 'due_date',
              header: 'Due Date',
              render: (row) => formatDate(row.due_date),
            },
            {
              key: 'assigned_to',
              header: 'Assigned To',
              render: (row) => row.assigned_to || '-',
            },
            {
              key: 'completed_at',
              header: 'Completed',
              render: (row) => (row.completed_at ? formatDate(row.completed_at) : '-'),
            },
          ]}
          rows={recentChecks as (MaintenanceCheck & { job_plans: { name: string } | null } & Record<string, unknown>)[]}
          emptyMessage="No maintenance checks found for this site."
        />
      </div>

      {/* Recent Test Records Table */}
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Recent Test Records</h2>
        <DataTable<TestRecord & Record<string, unknown>>
          columns={[
            {
              key: 'test_type',
              header: 'Test Type',
            },
            {
              key: 'test_date',
              header: 'Test Date',
              render: (row) => formatDate(row.test_date),
            },
            {
              key: 'result',
              header: 'Result',
              render: (row) => (
                <StatusBadge
                  status={row.result === 'pass' ? 'complete' : row.result === 'fail' ? 'blocked' : 'not-started'}
                  label={formatTestResult(row.result)}
                />
              ),
            },
            {
              key: 'tested_by',
              header: 'Tested By',
              render: (row) => row.tested_by || '-',
            },
            {
              key: 'next_test_due',
              header: 'Next Test Due',
              render: (row) => (row.next_test_due ? formatDate(row.next_test_due) : '-'),
            },
          ]}
          rows={recentTests as (TestRecord & Record<string, unknown>)[]}
          emptyMessage="No test records found for this site."
        />
      </div>
    </div>
  )
}
