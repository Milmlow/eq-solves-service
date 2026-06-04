import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckDetailPage } from './CheckDetailPage'
import { LinkedTestsPanel } from './LinkedTestsPanel'
import { ContractScopeBanner } from '@/components/ui/ContractScopeBanner'
import { SiteContextCard } from './SiteContextCard'
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
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Fetch the maintenance check — pull the site context fields (address,
  // lat/lng, photo, primary contact id) so the SiteContextCard can render
  // "where do I need to go" without a second roundtrip on the way in.
  const { data: check, error } = await supabase
    .from('maintenance_checks')
    .select(`
      *,
      job_plans(name),
      sites(
        id, name, code, address, city, state, postcode, country,
        latitude, longitude, photo_url, primary_contact_id,
        gate_code, parking_notes, after_hours_phone, safety_notes
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error || !check) notFound()

  // Resolve the site's primary contact (name + phone + role) if the site
  // has one nominated. Site_contacts is tenant-scoped via RLS already.
  type SiteShape = {
    id: string; name: string; code: string | null
    address: string | null; city: string | null; state: string | null
    postcode: string | null; country: string | null
    latitude: number | null; longitude: number | null
    photo_url: string | null; primary_contact_id: string | null
    gate_code: string | null; parking_notes: string | null
    after_hours_phone: string | null; safety_notes: string | null
  }
  const site = (check.sites as SiteShape | null)
  let siteContact: { name: string; role: string | null; phone: string | null; email: string | null } | null = null
  if (site?.primary_contact_id) {
    const { data: contact } = await supabase
      .from('site_contacts')
      .select('name, role, phone, email')
      .eq('id', site.primary_contact_id)
      .maybeSingle()
    siteContact = (contact ?? null) as typeof siteContact
  }

  // Resolve assignee name
  let assigneeName: string | null = null
  if (check.assigned_to) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', check.assigned_to)
      .maybeSingle()
    assigneeName = profile?.full_name ?? profile?.email ?? null
  }

  // Fetch check_assets with asset details
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location, job_plans(name))')
    .eq('check_id', id)
    .order('created_at')

  // Fetch all check items (Supabase defaults to 1000 rows — lift the cap)
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', id)
    .order('sort_order')
    .limit(10000)

  // Per-asset frequency map: asset_id → string[]. Populated for all checks
  // so the asset table can show frequency pills next to each asset's plan.
  // For single-frequency checks every asset gets the same tag. For multi-
  // frequency import checks each asset gets only the cycles its items cover.
  const assetFreqMap: Record<string, string[]> = {}
  const checkFrequency = check.frequency as string | null
  const checkFreqTags = (check as { frequency_tags?: string[] | null }).frequency_tags

  if (checkFrequency) {
    // Single-frequency check — every asset shares the same cycle.
    for (const ca of checkAssets ?? []) {
      assetFreqMap[ca.asset_id] = [checkFrequency]
    }
  } else if (checkFreqTags?.length) {
    // Multi-frequency import check — derive per-asset tags from which
    // job_plan_items flags are set on each asset's check_items.
    const jpiIds = Array.from(
      new Set((allItems ?? []).map(i => i.job_plan_item_id).filter(Boolean) as string[]),
    )
    if (jpiIds.length > 0) {
      // Cast to unknown first — freq_6yr/freq_8yr were added after the last
      // type generation so the generated types don't know about them yet.
      const { data: jpiRows } = await (supabase
        .from('job_plan_items')
        .select('id, freq_monthly, freq_quarterly, freq_semi_annual, freq_annual, freq_2yr, freq_3yr, freq_5yr, freq_6yr, freq_8yr, freq_10yr')
        .in('id', jpiIds) as unknown as Promise<{ data: Record<string, unknown>[] | null }>)
      const jpiById = new Map((jpiRows ?? []).map(r => [r.id as string, r]))
      const FREQ_FLAGS: [string, string][] = [
        ['freq_monthly', 'monthly'], ['freq_quarterly', 'quarterly'],
        ['freq_semi_annual', 'semi_annual'], ['freq_annual', 'annual'],
        ['freq_2yr', '2yr'], ['freq_3yr', '3yr'], ['freq_5yr', '5yr'],
        ['freq_6yr', '6yr'], ['freq_8yr', '8yr'], ['freq_10yr', '10yr'],
      ]
      for (const item of allItems ?? []) {
        if (!item.asset_id || !item.job_plan_item_id) continue
        const jpi = jpiById.get(item.job_plan_item_id) as Record<string, boolean> | undefined
        if (!jpi) continue
        const tags = assetFreqMap[item.asset_id] ?? []
        for (const [flag, freq] of FREQ_FLAGS) {
          // Only include frequencies that were actually used in this check —
          // job_plan_items often have multiple freq flags set (e.g. annual +
          // 5yr + quarterly), but only the cycles in frequency_tags were
          // imported. Filtering to that set avoids phantom pills.
          if (jpi[flag] && !tags.includes(freq) && checkFreqTags.includes(freq)) tags.push(freq)
        }
        assetFreqMap[item.asset_id] = tags
      }

      // Reduce multi-frequency assets to ONE pill — the lowest frequency
      // (longest cycle). A 2yr service encompasses the annual and semi-annual
      // tasks within the same job plan, so showing "2" is the correct summary.
      // Order: monthly → quarterly → semi_annual → annual → 2yr → … → 10yr
      const FREQ_ORDER = [
        'monthly', 'quarterly', 'semi_annual', 'annual',
        '2yr', '3yr', '5yr', '6yr', '8yr', '10yr',
      ]
      for (const assetId of Object.keys(assetFreqMap)) {
        const tags = assetFreqMap[assetId]
        if (tags.length <= 1) continue
        // Sort descending by index in FREQ_ORDER (highest index = lowest frequency)
        const sorted = [...tags].sort(
          (a, b) => FREQ_ORDER.indexOf(b) - FREQ_ORDER.indexOf(a),
        )
        assetFreqMap[assetId] = [sorted[0]]
      }
    }
  }

  // Fetch attachments
  const { data: attachments } = await supabase
    .from('attachments')
    .select('*')
    .eq('entity_type', 'maintenance_check')
    .eq('entity_id', id)
    .order('created_at')

  const checkName = check.custom_name ?? (check.job_plans as { name: string } | null)?.name ?? 'Maintenance Check'

  // Status-driven page accent (2026-04-28 chrome polish). A hairline
  // colour bar at the top of the page so the eye registers the check's
  // health before reading the body. Subtle — doesn't dominate the page.
  const statusAccent =
    check.status === 'complete'    ? 'bg-green-500'  :
    check.status === 'overdue'     ? 'bg-red-500'    :
    check.status === 'in_progress' ? 'bg-amber-500'  :
    check.status === 'cancelled'   ? 'bg-gray-400'   :
                                     'bg-eq-sky'

  return (
    <div className="space-y-4">
      <div className={`-mx-4 lg:-mx-8 -mt-4 lg:-mt-8 mb-2 h-1 ${statusAccent}`} aria-hidden />
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: checkName },
        ]} />
        <h1 className="text-3xl font-bold text-eq-ink mt-3 tracking-tight">{checkName}</h1>
        <p className="text-sm text-eq-grey mt-1">
          {site?.name ?? '—'}
          {check.frequency && <span> · {(check.frequency as string).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>}
          {check.due_date && <span> · Due {new Date(check.due_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
        </p>
        {/* Kind-aware tagline — tells the tech which workflow they're about
            to work in so they can pre-empt the asset-table vs linked-tests
            split (UX audit PR #149 §2.15 / §B.15). */}
        {(() => {
          const kind = (check as { kind?: string | null }).kind ?? 'maintenance'
          const tagline =
            kind === 'maintenance' ? 'PPM check — work through the asset table.' :
            kind === 'acb'         ? 'ACB test — open each linked test below to run the 3-step workflow.' :
            kind === 'nsx'         ? 'NSX test — open each linked test below to run the 3-step workflow.' :
            kind === 'rcd'         ? 'RCD test — open each linked test below to record per-circuit timing.' :
            kind === 'general'     ? 'General test — fill in the test record.' :
            null
          return tagline ? (
            <p className="text-xs text-eq-deep mt-1 italic">{tagline}</p>
          ) : null
        })()}
      </div>
      {/* Site context — address, contact, map link. Sits at the top of the
          page so a tech opening the check on their phone sees "where do I
          need to go" before anything else. Renders nothing when the site
          has no address + no contact + no photo. */}
      {site && (
        <SiteContextCard
          site={{
            name: site.name,
            code: site.code,
            address: site.address,
            city: site.city,
            state: site.state,
            postcode: site.postcode,
            country: site.country,
            latitude: site.latitude,
            longitude: site.longitude,
            photo_url: site.photo_url,
            gate_code: site.gate_code,
            parking_notes: site.parking_notes,
            after_hours_phone: site.after_hours_phone,
            safety_notes: site.safety_notes,
          }}
          contact={siteContact}
        />
      )}
      {/* Contract scope context — shown above the detail body so site teams
          see what's in/out of scope before they pick assets to inspect.
          Phase 2 of Royce's 26-Apr review. */}
      <ContractScopeBanner
        siteId={check.site_id as string | null}
        jobPlanId={check.job_plan_id as string | null}
        hideWhenEmpty
      />
      {/* Phase 3 of the Testing simplification — surface linked ACB/NSX/RCD
          tests inline so the user doesn't have to hunt across tabs. Renders
          nothing when no tests are linked (most kind=maintenance checks). */}
      <LinkedTestsPanel
        checkId={id}
        siteId={check.site_id as string | null}
      />
      <CheckDetailPage
        check={{ ...check, assignee_name: assigneeName } as never}
        items={(allItems ?? []) as MaintenanceCheckItem[]}
        checkAssets={(checkAssets ?? []) as never}
        attachments={(attachments ?? []) as Attachment[]}
        assetFreqMap={assetFreqMap}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
        isAssigned={check.assigned_to === user?.id}
        isTechnician={userRole === 'employee'}
      />
    </div>
  )
}
