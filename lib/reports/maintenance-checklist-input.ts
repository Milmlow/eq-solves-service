/**
 * buildMaintenanceChecklistInput — gathers everything the run-sheet generator
 * needs for one maintenance check and returns a MaintenanceChecklistInput.
 *
 * Extracted from app/api/maintenance-checklist/route.ts (2026-06-06) so the
 * same input can be built outside the HTTP route — specifically the pre-visit
 * tech brief, which attaches the run-sheet DOCX to its email. The route still
 * owns auth + role gating + the HTTP response; this owns only data gathering.
 *
 * Returns null when the check doesn't exist for the tenant (route → 404).
 * Throws on hard fetch failures (route → 500; brief → skips the attachment).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedTenantSettings } from '@/lib/tenant/getTenantSettings'
import type { MaintenanceChecklistInput, ChecklistAsset } from '@/lib/reports/maintenance-checklist'
import { fetchLogoImage } from '@/lib/reports/report-branding'
import { TENANT_LOGO_ON_DARK, CUSTOMER_LOGO_LIGHT } from '@/lib/reports/sizing'

export type ChecklistFormat = 'simple' | 'standard' | 'detailed'

export function normaliseChecklistFormat(raw: string | null): ChecklistFormat {
  const v = (raw ?? 'standard').toLowerCase()
  if (v === 'simple' || v === 'summary') return 'simple'
  if (v === 'detailed') return 'detailed'
  return 'standard'
}

export async function buildMaintenanceChecklistInput(
  supabase: SupabaseClient,
  checkId: string,
  tenantId: string,
  format: ChecklistFormat,
): Promise<MaintenanceChecklistInput | null> {
  // Fetch maintenance check with site + maintenance plan
  const { data: check } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name, code), sites(name)')
    .eq('id', checkId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!check) return null

  // Fetch check_assets with related asset info
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location)')
    .eq('check_id', checkId)
    .order('created_at')

  if (!checkAssets) throw new Error('Failed to fetch check assets')

  // Fetch ALL check items for this check in one query (lift Supabase 1000-row default)
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', checkId)
    .order('sort_order')
    .limit(10000)

  if (!allItems) throw new Error('Failed to fetch check items')

  // Group items by check_asset_id
  const itemsByCheckAsset: Record<string, typeof allItems> = {}
  for (const item of allItems) {
    const caId = item.check_asset_id ?? '_unlinked'
    if (!itemsByCheckAsset[caId]) itemsByCheckAsset[caId] = []
    itemsByCheckAsset[caId].push(item)
  }

  // Fetch tenant settings for branding — primary colour drives the brand strip.
  const tenantSettings = await getCachedTenantSettings(tenantId)

  const productName = tenantSettings?.product_name ?? 'EQ Solves'
  const companyName = tenantSettings?.report_company_name ?? productName
  const companyAbn = tenantSettings?.report_company_abn ?? null
  const primaryColour = (tenantSettings?.primary_colour ?? '#3DA8D8').replace('#', '')

  // Customer logo (if site has a customer)
  let customerLogoUrl: string | null = null
  const siteRow = check.sites as { name?: string; customer_id?: string | null } | null
  if (siteRow?.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('logo_url')
      .eq('id', siteRow.customer_id)
      .maybeSingle()
    customerLogoUrl = customer?.logo_url ?? null
  }

  const tenantLogoLightUrl = tenantSettings?.report_logo_url ?? tenantSettings?.logo_url ?? null
  const tenantLogoDarkUrl = tenantSettings?.report_logo_url_on_dark ?? tenantSettings?.logo_url_on_dark ?? null

  const [tenantLogoImage, customerLogoImage] = await Promise.all([
    fetchLogoImage(tenantLogoDarkUrl ?? tenantLogoLightUrl, TENANT_LOGO_ON_DARK),
    fetchLogoImage(customerLogoUrl, CUSTOMER_LOGO_LIGHT),
  ])

  // Resolve user names (assigned_to)
  const userIds = new Set<string>()
  if (check.assigned_to) userIds.add(check.assigned_to)

  const userMap: Record<string, string> = {}
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', Array.from(userIds))
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  // Build per-asset sections from check_assets (kind=maintenance flow).
  let checklistAssets: ChecklistAsset[] = checkAssets.map(ca => {
    const asset = ca.assets as { name: string; maximo_id: string | null; location: string | null } | null
    const items = itemsByCheckAsset[ca.id] ?? []

    return {
      assetName: asset?.name ?? 'Unknown Asset',
      assetId: asset?.maximo_id ?? ca.asset_id,
      location: asset?.location ?? '—',
      workOrderNumber: ca.work_order_number ?? null,
      tasks: items.map((item, idx) => ({
        order: idx + 1,
        description: item.description,
      })),
      notes: ca.notes ?? null,
    }
  })

  // Test-bench checks (kind in acb/nsx/rcd): synthesize ChecklistAsset entries
  // from the linked tests so the run-sheet has something useful to print.
  const kind = (check as { kind?: string | null }).kind ?? 'maintenance'
  const isTestKind = kind === 'acb' || kind === 'nsx' || kind === 'rcd'

  if (isTestKind) {
    if (kind === 'acb' || kind === 'nsx') {
      const table = kind === 'acb' ? 'acb_tests' : 'nsx_tests'
      const { data: tests } = await supabase
        .from(table)
        .select(
          'id, asset_id, cb_make, cb_model, cb_serial, brand, breaker_type, assets(name, maximo_id, location)',
        )
        .eq('check_id', checkId)
        .eq('is_active', true)
        .order('created_at')

      checklistAssets = (tests ?? []).map((t) => {
        const a = t.assets as { name: string; maximo_id: string | null; location: string | null } | { name: string; maximo_id: string | null; location: string | null }[] | null
        const asset = Array.isArray(a) ? a[0] ?? null : a
        return {
          assetName: asset?.name ?? 'Breaker',
          assetId: asset?.maximo_id ?? '—',
          location: asset?.location ?? '—',
          workOrderNumber: null,
          tasks: [],
          notes: null,
          testKind: kind as 'acb' | 'nsx',
        }
      })
    } else if (kind === 'rcd') {
      const { data: rcdTests } = await supabase
        .from('rcd_tests')
        .select('id, asset_id, assets(name, jemena_asset_id, location)')
        .eq('check_id', checkId)
        .eq('is_active', true)
        .order('created_at')

      const testIds = (rcdTests ?? []).map((t) => t.id)
      const circuitsByTest = new Map<string, Array<{ section_label: string | null; circuit_no: string; normal_trip_current_ma: number | null }>>()
      if (testIds.length > 0) {
        const { data: allCircuits } = await supabase
          .from('rcd_test_circuits')
          .select('rcd_test_id, section_label, circuit_no, normal_trip_current_ma, sort_order')
          .in('rcd_test_id', testIds)
          .order('sort_order')
        for (const c of allCircuits ?? []) {
          const arr = circuitsByTest.get(c.rcd_test_id) ?? []
          arr.push({
            section_label: c.section_label as string | null,
            circuit_no: c.circuit_no as string,
            normal_trip_current_ma: c.normal_trip_current_ma as number | null,
          })
          circuitsByTest.set(c.rcd_test_id, arr)
        }
      }

      checklistAssets = (rcdTests ?? []).map((t) => {
        const a = t.assets as { name: string; jemena_asset_id: string | null; location: string | null } | { name: string; jemena_asset_id: string | null; location: string | null }[] | null
        const asset = Array.isArray(a) ? a[0] ?? null : a
        const circuits = circuitsByTest.get(t.id) ?? []
        const tasks = circuits.length > 0
          ? circuits.map((c, idx) => {
              const section = c.section_label ? `${c.section_label} · ` : ''
              const rating = c.normal_trip_current_ma ? `${c.normal_trip_current_ma}mA` : ''
              return {
                order: idx + 1,
                description: `${section}Circuit ${c.circuit_no} (${rating}) — X1 No-Trip 0°/180°: ___ / ___ ms · X1 Trip 0°/180°: ___ / ___ ms · X5 0°/180°: ___ / ___ ms · Btn ☐`,
              }
            })
          : [
              { order: 1, description: 'No circuits enumerated yet — record per-circuit timing values below' },
            ]
        return {
          assetName: asset?.name ?? 'Board',
          assetId: asset?.jemena_asset_id ?? '—',
          location: asset?.location ?? '—',
          workOrderNumber: null,
          tasks,
          notes: null,
        }
      })
    }
  }

  // Australian long-form dates to match the other report generators.
  const dateFmt: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'long', year: 'numeric' }
  const dueDateStr = check.due_date ? new Date(check.due_date).toLocaleDateString('en-AU', dateFmt) : '—'
  const printedDateStr = new Date().toLocaleDateString('en-AU', dateFmt)
  const rawFreq = check.frequency?.replace(/_/g, ' ') ?? '—'
  const frequency = rawFreq.charAt(0).toUpperCase() + rawFreq.slice(1)

  const distinctWoNumbers = Array.from(
    new Set(checkAssets.map(ca => ca.work_order_number).filter((wo): wo is string => !!wo)),
  )
  const maximoWoSummary =
    distinctWoNumbers.length === 0 ? null
    : distinctWoNumbers.length === 1 ? distinctWoNumbers[0]
    : `Multiple (${distinctWoNumbers.length} — see asset sections)`

  return {
    companyName,
    companyAbn,
    checkName: check.custom_name ?? `${(check.job_plans as { name: string } | null)?.name ?? 'Check'} - ${frequency}`,
    siteName: (check.sites as { name: string } | null)?.name ?? 'Unknown Site',
    dueDate: dueDateStr,
    frequency,
    assignedTo: check.assigned_to ? (userMap[check.assigned_to] ?? 'Unassigned') : null,
    maximoWONumber: maximoWoSummary,
    maximoPMNumber: (check.job_plans as { code: string | null } | null)?.code ?? null,
    printedDate: printedDateStr,
    assets: checklistAssets,
    tenantProductName: productName,
    primaryColour,
    deepColour: tenantSettings?.deep_colour ?? null,
    iceColour: tenantSettings?.ice_colour ?? null,
    inkColour: tenantSettings?.ink_colour ?? null,
    tenantLogoImage,
    customerLogoImage,
    format,
  }
}
