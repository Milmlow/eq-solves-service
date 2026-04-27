'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import {
  parseCommercialSheet,
  type ParsedScope,
  type ParsedSheet,
} from '@/lib/parsers/commercial-sheet'

// ── Types returned to the UI ────────────────────────────────────────────

/** A customer the upload could plausibly target. Returned during preview. */
export interface CustomerOption {
  id: string
  name: string
  code: string | null
  contract_template: string | null
}

/** A site the upload could plausibly target. Returned during preview. */
export interface SiteOption {
  id: string
  customer_id: string
  code: string | null
  name: string
}

/** Existing-data counts per customer/year, for the "will wipe" warning. */
export interface ExistingCounts {
  scopes: number
  calendar: number
  gaps: number
}

export interface PreviewResult {
  ok: true
  filename: string
  parsed: ParsedSheet
  /** All admin-tenant customers, for the picker (small list, fine to ship eagerly). */
  customers: CustomerOption[]
  /** Sites for ALL customers, indexed by customer for client-side filter. */
  sites: SiteOption[]
  /** When site_hint resolves to a real site, this is its id. */
  matchedSiteId: string | null
}

export interface CommitResult {
  ok: true
  inserted: { scopes: number; additional_items: number }
  wiped: ExistingCounts
}

export type ActionFailure = { ok: false; error: string }

// ── Helpers ─────────────────────────────────────────────────────────────

async function readFileFromForm(formData: FormData): Promise<{ buffer: Buffer; filename: string } | ActionFailure> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { ok: false, error: 'No file uploaded.' }
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return { ok: false, error: 'File must be a .xlsx workbook.' }
  }
  const arrayBuffer = await file.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), filename: file.name }
}

// ── Preview ─────────────────────────────────────────────────────────────

/**
 * Parse the upload, fetch the tenant's customers + sites for the picker,
 * and try to auto-match the workbook's site_hint to an existing site code.
 * No DB writes.
 */
export async function previewCommercialSheetAction(
  formData: FormData,
): Promise<PreviewResult | ActionFailure> {
  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  const fileResult = await readFileFromForm(formData)
  if ('ok' in fileResult && fileResult.ok === false) return fileResult
  const { buffer, filename } = fileResult as { buffer: Buffer; filename: string }

  const parsed = await parseCommercialSheet(buffer, filename)
  if (parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors.join(' · ') }
  }

  const [{ data: customers }, { data: sites }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, code, contract_template')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('sites')
      .select('id, customer_id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('code'),
  ])

  const sitesList = (sites ?? []) as SiteOption[]
  const matchedSiteId =
    parsed.site_hint
      ? sitesList.find((s) => s.code?.toUpperCase() === parsed.site_hint)?.id ?? null
      : null

  return {
    ok: true,
    filename,
    parsed,
    customers: (customers ?? []) as CustomerOption[],
    sites: sitesList,
    matchedSiteId,
  }
}

/**
 * Count the rows that would be wiped if the user confirms commit. Pure
 * read — no DB writes. Mirrors the wipe block inside commitImportAction.
 */
export async function previewExistingCountsAction(
  formData: FormData,
): Promise<{ ok: true; counts: ExistingCounts } | ActionFailure> {
  const parsed = z
    .object({
      customer_id: z.string().uuid(),
      financial_year: z.string().regex(/^\d{4}$/),
    })
    .safeParse({
      customer_id: formData.get('customer_id'),
      financial_year: formData.get('financial_year'),
    })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  const year = parseInt(parsed.data.financial_year, 10)
  const yearText = String(year)

  const { data: siteRows } = await supabase
    .from('sites')
    .select('id')
    .eq('customer_id', parsed.data.customer_id)
    .eq('tenant_id', tenantId)
  const siteIds = (siteRows ?? []).map((s) => s.id as string)

  const [scopes, gaps, calDated, calNull] = await Promise.all([
    supabase
      .from('contract_scopes')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', parsed.data.customer_id)
      .eq('tenant_id', tenantId)
      .eq('financial_year', yearText),
    supabase
      .from('scope_coverage_gaps')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', parsed.data.customer_id)
      .eq('tenant_id', tenantId)
      .eq('contract_year', year),
    siteIds.length > 0
      ? supabase
          .from('pm_calendar')
          .select('id', { count: 'exact', head: true })
          .in('site_id', siteIds)
          .eq('tenant_id', tenantId)
          .gte('start_time', `${yearText}-01-01`)
          .lt('start_time', `${year + 1}-01-01`)
      : Promise.resolve({ count: 0 } as { count: number | null }),
    siteIds.length > 0
      ? supabase
          .from('pm_calendar')
          .select('id', { count: 'exact', head: true })
          .in('site_id', siteIds)
          .eq('tenant_id', tenantId)
          .is('start_time', null)
          .eq('financial_year', yearText)
      : Promise.resolve({ count: 0 } as { count: number | null }),
  ])

  return {
    ok: true,
    counts: {
      scopes: scopes.count ?? 0,
      calendar: (calDated.count ?? 0) + (calNull.count ?? 0),
      gaps: gaps.count ?? 0,
    },
  }
}

// ── Commit ──────────────────────────────────────────────────────────────

const commitSchema = z.object({
  customer_id: z.string().uuid(),
  site_id: z.string().uuid(),
  financial_year: z.string().regex(/^\d{4}$/),
  confirm_name: z.string().min(1),
  wipe_first: z.string().optional(),
})

/**
 * Re-parse the upload, optionally wipe existing contract data for the
 * target customer/year, then INSERT the parsed scopes + additional items.
 *
 * Re-parsing on commit (rather than carrying parsed JSON through the form)
 * means the operator can't have tampered with the data between preview and
 * commit — the xlsx file is the source of truth.
 */
export async function commitImportAction(
  formData: FormData,
): Promise<CommitResult | ActionFailure> {
  const parsedForm = commitSchema.safeParse({
    customer_id: formData.get('customer_id'),
    site_id: formData.get('site_id'),
    financial_year: formData.get('financial_year'),
    confirm_name: formData.get('confirm_name'),
    wipe_first: formData.get('wipe_first') ?? '',
  })
  if (!parsedForm.success) {
    return { ok: false, error: parsedForm.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { customer_id, site_id, financial_year, confirm_name, wipe_first } = parsedForm.data
  const wipeFirst = wipe_first === 'true'

  const fileResult = await readFileFromForm(formData)
  if ('ok' in fileResult && fileResult.ok === false) return fileResult
  const { buffer, filename } = fileResult as { buffer: Buffer; filename: string }

  const { supabase, tenantId, role } = await requireUser()
  if (!isAdmin(role)) return { ok: false, error: 'Not authorised.' }

  // Verify customer + site, and check the typed-name confirm.
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id, name, tenant_id')
    .eq('id', customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (custErr) return { ok: false, error: custErr.message }
  if (!customer) return { ok: false, error: 'Customer not found.' }
  if ((customer.name ?? '').trim() !== confirm_name.trim()) {
    return { ok: false, error: 'Confirmation name did not match.' }
  }

  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, customer_id, tenant_id')
    .eq('id', site_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (siteErr) return { ok: false, error: siteErr.message }
  if (!site || site.customer_id !== customer_id) {
    return { ok: false, error: 'Site is not part of this customer.' }
  }

  // Re-parse for commit — xlsx is the source of truth.
  const parsed = await parseCommercialSheet(buffer, filename)
  if (parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors.join(' · ') }
  }
  if (parsed.scopes.length === 0 && parsed.additional_items.length === 0) {
    return { ok: false, error: 'Workbook contained no priced JPs or Additional Items.' }
  }

  const year = parseInt(financial_year, 10)
  const yearText = String(year)
  const wiped: ExistingCounts = { scopes: 0, calendar: 0, gaps: 0 }

  if (wipeFirst) {
    // Mirror the danger-zone wipe — same 3 tables, same scoping. Inline
    // because the danger action belongs to /customers/[id] and re-importing
    // here shouldn't take a dependency on that page's action surface.
    const { data: siteRows } = await supabase
      .from('sites')
      .select('id')
      .eq('customer_id', customer_id)
      .eq('tenant_id', tenantId)
    const siteIds = (siteRows ?? []).map((s) => s.id as string)

    const { data: gapsDel, error: gapsErr } = await supabase
      .from('scope_coverage_gaps')
      .delete()
      .eq('customer_id', customer_id)
      .eq('tenant_id', tenantId)
      .eq('contract_year', year)
      .select('id')
    if (gapsErr) return { ok: false, error: `Wipe gaps: ${gapsErr.message}` }
    wiped.gaps = (gapsDel ?? []).length

    if (siteIds.length > 0) {
      const { data: cal1, error: cal1Err } = await supabase
        .from('pm_calendar')
        .delete()
        .in('site_id', siteIds)
        .eq('tenant_id', tenantId)
        .gte('start_time', `${yearText}-01-01`)
        .lt('start_time', `${year + 1}-01-01`)
        .select('id')
      if (cal1Err) return { ok: false, error: `Wipe calendar: ${cal1Err.message}` }
      const { data: cal2, error: cal2Err } = await supabase
        .from('pm_calendar')
        .delete()
        .in('site_id', siteIds)
        .eq('tenant_id', tenantId)
        .is('start_time', null)
        .eq('financial_year', yearText)
        .select('id')
      if (cal2Err) return { ok: false, error: `Wipe calendar (null): ${cal2Err.message}` }
      wiped.calendar = (cal1 ?? []).length + (cal2 ?? []).length
    }

    const { data: scopeDel, error: scopeDelErr } = await supabase
      .from('contract_scopes')
      .delete()
      .eq('customer_id', customer_id)
      .eq('tenant_id', tenantId)
      .eq('financial_year', yearText)
      .select('id')
    if (scopeDelErr) return { ok: false, error: `Wipe scopes: ${scopeDelErr.message}` }
    wiped.scopes = (scopeDel ?? []).length
  }

  // Insert. Single source_import_id ties all rows from this commit so the
  // operator can roll back via that id if needed.
  const sourceImportId = crypto.randomUUID()
  const importedAt = new Date().toISOString()

  const buildScopeRow = (s: ParsedScope) => ({
    tenant_id: tenantId,
    customer_id,
    site_id,
    financial_year: yearText,
    scope_item: s.scope_item,
    is_included: true,
    jp_code: s.jp_code,
    asset_qty: s.asset_qty,
    intervals_text: s.intervals_text,
    billing_basis: s.billing_basis,
    cycle_costs: s.cycle_costs,
    year_totals: s.year_totals,
    due_years: s.due_years,
    labour_hours_per_asset: s.labour_hours_per_asset,
    unit_rate_per_asset: s.unit_rate_per_asset,
    notes: s.notes,
    source_workbook: filename,
    source_sheet: s.source_sheet,
    source_row: s.source_row,
    imported_at: importedAt,
    source_import_id: sourceImportId,
    has_bundled_scope: s.has_bundled_scope,
    commercial_gap: s.commercial_gap,
    status: 'committed' as const,
  })

  const allRows = [...parsed.scopes, ...parsed.additional_items].map(buildScopeRow)
  const { error: insErr } = await supabase.from('contract_scopes').insert(allRows)
  if (insErr) return { ok: false, error: `Insert: ${insErr.message}` }

  await logAuditEvent({
    action: 'create',
    entityType: 'customer',
    entityId: customer_id,
    summary:
      `Imported ${parsed.scopes.length} JP + ${parsed.additional_items.length} additional ` +
      `into ${customer.name} (${yearText}) from ${filename}` +
      (wipeFirst
        ? ` — wiped first (${wiped.scopes} scopes, ${wiped.calendar} calendar, ${wiped.gaps} gaps)`
        : ''),
    metadata: {
      action_kind: 'commercial_sheet_import',
      financial_year: year,
      site_id,
      source_workbook: filename,
      source_import_id: sourceImportId,
      inserted_scopes: parsed.scopes.length,
      inserted_additional_items: parsed.additional_items.length,
      wipe_first: wipeFirst,
      wiped_counts: wiped,
    },
  })

  revalidatePath(`/customers/${customer_id}`)
  revalidatePath('/contract-scope')
  revalidatePath('/calendar')
  revalidatePath('/reports')
  revalidatePath('/dashboard')

  return {
    ok: true,
    inserted: { scopes: parsed.scopes.length, additional_items: parsed.additional_items.length },
    wiped,
  }
}
