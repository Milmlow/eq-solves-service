import { createClient } from '@/lib/supabase/server'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { LinkedTestsClient, type AcbNsxTestItem, type RcdTestItem } from './LinkedTestsClient'

/**
 * Threshold above which the Linked Tests panel collapses by default.
 * Below this, the list is small enough to scan on first paint so we
 * leave it expanded. Above, the panel takes too much vertical space
 * (Jemena May visit can carry 16+ RCD tests) so we hide behind a
 * chevron and let the tech expand on demand.
 */
const LINKED_TESTS_COLLAPSE_THRESHOLD = 5

/**
 * Server component — fetches all linked test records for a maintenance check
 * and passes them to the client-side LinkedTestsClient for filtering/display.
 * Returns null when no tests are linked (most kind=maintenance checks).
 */

type Joined<T> = T | T[] | null
function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

interface Props {
  checkId: string
  /** Site id — kept for parity with the legacy deep-link shape; no longer used. */
  siteId: string | null
}

export async function LinkedTestsPanel({ checkId }: Props) {
  const supabase = await createClient()

  const [acbRes, nsxRes, rcdRes] = await Promise.all([
    supabase
      .from('acb_tests')
      .select('id, asset_id, step1_status, step2_status, step3_status, overall_result, assets(id, name, serial_number)')
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('nsx_tests')
      .select('id, asset_id, step1_status, step2_status, step3_status, overall_result, assets(id, name, serial_number)')
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('rcd_tests')
      .select('id, asset_id, status, test_date, assets(id, name, jemena_asset_id)')
      .eq('check_id', checkId)
      .eq('is_active', true)
      .order('test_date', { ascending: false }),
  ])

  const rawAcb = acbRes.data ?? []
  const rawNsx = nsxRes.data ?? []
  const rawRcd = rcdRes.data ?? []

  const total = rawAcb.length + rawNsx.length + rawRcd.length
  if (total === 0) return null

  // Map to typed items for the client component
  const acb: AcbNsxTestItem[] = rawAcb.map((t) => {
    const asset = one(t.assets as Joined<{ id: string; name: string; serial_number: string | null }>)
    return {
      id: t.id,
      kind: 'acb' as const,
      assetName: asset?.name ?? '—',
      serialNumber: asset?.serial_number ?? null,
      step1Status: t.step1_status ?? null,
      step2Status: t.step2_status ?? null,
      step3Status: t.step3_status ?? null,
      overallResult: t.overall_result ?? null,
      href: `/testing/acb/${t.id}`,
    }
  })

  const nsx: AcbNsxTestItem[] = rawNsx.map((t) => {
    const asset = one(t.assets as Joined<{ id: string; name: string; serial_number: string | null }>)
    return {
      id: t.id,
      kind: 'nsx' as const,
      assetName: asset?.name ?? '—',
      serialNumber: asset?.serial_number ?? null,
      step1Status: t.step1_status ?? null,
      step2Status: t.step2_status ?? null,
      step3Status: t.step3_status ?? null,
      overallResult: t.overall_result ?? null,
      href: `/testing/nsx/${t.id}`,
    }
  })

  const rcd: RcdTestItem[] = rawRcd.map((t) => {
    const asset = one(t.assets as Joined<{ id: string; name: string; jemena_asset_id: string | null }>)
    return {
      id: t.id,
      assetName: asset?.name ?? '—',
      jemenaAssetId: asset?.jemena_asset_id ?? null,
      status: t.status,
      testDate: t.test_date,
      href: `/testing/rcd/${t.id}`,
    }
  })

  const summaryParts: string[] = []
  if (acb.length) summaryParts.push(`${acb.length} ACB`)
  if (nsx.length) summaryParts.push(`${nsx.length} NSX`)
  if (rcd.length) summaryParts.push(`${rcd.length} RCD`)

  return (
    <CollapsibleSection
      title="Test Records"
      summary={`${total} test${total === 1 ? '' : 's'} (${summaryParts.join(', ')})`}
      defaultOpen={total <= LINKED_TESTS_COLLAPSE_THRESHOLD}
      tone="subtle"
    >
      <LinkedTestsClient acb={acb} nsx={nsx} rcd={rcd} />
    </CollapsibleSection>
  )
}
