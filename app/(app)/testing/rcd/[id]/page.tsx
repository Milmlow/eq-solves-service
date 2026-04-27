import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/actions/auth'
import { canWrite } from '@/lib/utils/roles'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ChevronLeft } from 'lucide-react'
import { RcdTestEditor, type RcdTestEditorCircuit } from './RcdTestEditor'

type Joined<T> = T | T[] | null

function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * RCD test detail — header card + per-circuit grid with onsite edit mode.
 *
 * Server component handles auth + data fetch. Render is delegated to the
 * RcdTestEditor client component which toggles between read-only and edit
 * mode. Edit mode lets writers update timing values, button checks, and
 * action notes; "Save & mark complete" propagates to the linked
 * maintenance_check (if any).
 */
export default async function RcdTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { role } = await requireUser()
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('rcd_tests')
    .select(
      '*, sites(name, code), assets(name, jemena_asset_id, manufacturer, model, location), customers(name)',
    )
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !test) notFound()

  const site = one(test.sites as Joined<{ name: string; code: string | null }>)
  const asset = one(test.assets as Joined<{
    name: string
    jemena_asset_id: string | null
    manufacturer: string | null
    model: string | null
    location: string | null
  }>)
  const customer = one(test.customers as Joined<{ name: string }>)

  const { data: circuits } = await supabase
    .from('rcd_test_circuits')
    .select('*')
    .eq('rcd_test_id', id)
    .order('sort_order')
    .order('section_label', { nullsFirst: true })
    .order('circuit_no')

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Testing', href: '/testing' },
            { label: 'RCD Testing', href: '/testing/rcd' },
            { label: asset?.name ?? 'Test' },
          ]}
        />
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-3xl font-bold text-eq-sky">
              {asset?.name ?? 'RCD Test'}
            </h1>
            <p className="text-sm text-eq-grey mt-1">
              {site?.name ?? '—'}
              {customer?.name && <span> · {customer.name}</span>}
              <span> · {test.test_date}</span>
              {test.check_id && (
                <>
                  {' · '}
                  <Link
                    href={`/maintenance/${test.check_id}`}
                    className="text-eq-deep hover:text-eq-sky underline"
                  >
                    linked maintenance check
                  </Link>
                </>
              )}
            </p>
          </div>
          <Link
            href="/testing/rcd"
            className="text-sm text-eq-deep hover:text-eq-sky inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to list
          </Link>
        </div>
      </div>

      <RcdTestEditor
        test={{
          id: test.id,
          test_date: test.test_date,
          status: test.status,
          technician_name_snapshot: test.technician_name_snapshot,
          technician_initials: test.technician_initials,
          site_rep_name: test.site_rep_name,
          equipment_used: test.equipment_used,
          notes: test.notes,
          check_id: test.check_id,
        }}
        initialCircuits={(circuits ?? []) as RcdTestEditorCircuit[]}
        canEdit={canWrite(role)}
        siteName={site?.name ?? null}
        assetName={asset?.name ?? null}
      />
    </div>
  )
}
