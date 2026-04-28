import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ChevronLeft } from 'lucide-react'
import { NsxTestWorkflowClient } from './NsxTestWorkflowClient'
import type { NsxTest, NsxTestReading } from '@/lib/types'

type Joined<T> = T | T[] | null
function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Phase 4 (2026-04-28) — dedicated, deep-linkable detail page for a single
 * NSX test. Mirrors /testing/rcd/[id] and /testing/acb/[testId] so all
 * three test types share a test-centric URL pattern.
 */
export default async function NsxTestDetailPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('nsx_tests')
    .select('*, assets(name), sites(name), maintenance_checks!check_id(id, custom_name)')
    .eq('id', testId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !test) notFound()

  const { data: readings } = await supabase
    .from('nsx_test_readings')
    .select('*')
    .eq('nsx_test_id', testId)
    .order('sort_order')

  const asset = one(test.assets as Joined<{ name: string }>)
  const site = one(test.sites as Joined<{ name: string }>)
  const linkedCheck = one(
    test.maintenance_checks as Joined<{ id: string; custom_name: string | null }>,
  )

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Testing', href: '/testing' },
            { label: 'NSX Testing', href: '/testing/nsx' },
            { label: asset?.name ?? 'Test' },
          ]}
        />
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-3xl font-bold text-eq-sky">
              {asset?.name ?? 'NSX Test'}
            </h1>
            <p className="text-sm text-eq-grey mt-1">
              {site?.name ?? '—'}
              <span> · {test.test_date}</span>
              {linkedCheck && (
                <>
                  {' · '}
                  <Link
                    href={`/maintenance/${linkedCheck.id}`}
                    className="text-eq-deep hover:text-eq-sky underline"
                  >
                    {linkedCheck.custom_name ?? 'linked check'}
                  </Link>
                </>
              )}
            </p>
          </div>
          <Link
            href="/testing/nsx"
            className="text-sm text-eq-deep hover:text-eq-sky inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to NSX list
          </Link>
        </div>
      </div>

      <NsxTestWorkflowClient
        test={test as NsxTest}
        readings={(readings ?? []) as NsxTestReading[]}
      />
    </div>
  )
}
