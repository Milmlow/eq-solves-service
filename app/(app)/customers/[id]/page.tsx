import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DataTable } from '@/components/ui/DataTable'
import { formatDate } from '@/lib/utils/format'
import { isAdmin as checkIsAdmin } from '@/lib/utils/roles'
import type { Customer, CustomerContact, Site, Role } from '@/lib/types'
import { CustomerContacts } from './CustomerContacts'

export default async function CustomerDetailPage({
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

  // Fetch customer
  const { data: customerRaw } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!customerRaw) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Customers', href: '/customers' }, { label: 'Not Found' }]} />
        <div className="text-center text-eq-grey">
          <p>Customer not found.</p>
        </div>
      </div>
    )
  }

  const customer = customerRaw as Customer

  // Fetch sites first (needed for asset count lookup)
  const [sitesRes, contactsRes] = await Promise.all([
    supabase
      .from('sites')
      .select('*', { count: 'exact' })
      .eq('customer_id', id)
      .eq('is_active', true),
    supabase
      .from('customer_contacts')
      .select('*')
      .eq('customer_id', id)
      .order('is_primary', { ascending: false })
      .order('name'),
  ])

  // Get asset count using the site IDs we already have
  const siteIds = (sitesRes.data ?? []).map((s: { id: string }) => s.id)
  let assetsRes: { count: number | null } = { count: 0 }
  if (siteIds.length > 0) {
    assetsRes = await supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .in('site_id', siteIds)
      .eq('is_active', true)
  }

  const sitesData = (sitesRes.data ?? []) as Site[]
  const sitesCount = sitesRes.count ?? 0
  const assetsCount = assetsRes.count ?? 0
  const contacts = (contactsRes.data ?? []) as CustomerContact[]

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Customers', href: '/customers' },
          { label: customer.name },
        ]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">{customer.name}</h1>
      </div>

      {/* Customer Info Header */}
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Code</p>
            <p className="text-sm font-medium text-eq-ink">{customer.code || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm font-medium text-eq-ink">{customer.email || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Phone</p>
            <p className="text-sm font-medium text-eq-ink">{customer.phone || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Status</p>
            <div className="mt-1">
              <StatusBadge status={customer.is_active ? 'active' : 'inactive'} />
            </div>
          </div>
        </div>
        {customer.logo_url && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Logo</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={customer.logo_url} alt="Customer logo" className="w-16 h-16 object-contain" />
          </div>
        )}
        {customer.address && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Address</p>
            <p className="text-sm text-eq-ink">
              {customer.address}
            </p>
          </div>
        )}
      </Card>

      {/* Customer Contacts */}
      <CustomerContacts customerId={id} contacts={contacts} isAdmin={userIsAdmin} />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Sites</p>
          <p className="text-3xl font-bold text-eq-ink">{sitesCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Assets</p>
          <p className="text-3xl font-bold text-eq-sky">{assetsCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Created</p>
          <p className="text-sm font-medium text-eq-ink">{formatDate(customer.created_at)}</p>
        </Card>
        <Card>
          <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Updated</p>
          <p className="text-sm font-medium text-eq-ink">{formatDate(customer.updated_at)}</p>
        </Card>
      </div>

      {/* Sites Table */}
      <div>
        <h2 className="text-lg font-bold text-eq-ink mb-3">Sites</h2>
        <DataTable<Site & Record<string, unknown>>
          columns={[
            {
              key: 'name',
              header: 'Site Name',
              render: (row) => (
                <a href={`/sites/${row.id}`} className="text-eq-sky hover:text-eq-deep font-medium">
                  {row.name}
                </a>
              ),
            },
            {
              key: 'code',
              header: 'Code',
              render: (row) => row.code || '-',
            },
            {
              key: 'address',
              header: 'Address',
              render: (row) => {
                const addressParts = [
                  row.address,
                  row.city,
                  row.state,
                  row.postcode,
                ].filter(Boolean)
                return addressParts.length > 0 ? addressParts.join(', ') : '-'
              },
            },
            {
              key: 'is_active',
              header: 'Status',
              render: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
            },
          ]}
          rows={sitesData as (Site & Record<string, unknown>)[]}
          emptyMessage="No sites found for this customer."
        />
      </div>
    </div>
  )
}
