/**
 * canonical-pull.ts — pull canonical records INTO eq-service (reverse of write-through).
 *
 * Fetches customers, sites, and assets from the canonical API and upserts them
 * into eq-service's local DB using the admin client (bypasses RLS, runs across
 * all tenants). New records are inserted; existing records (matched by canonical_id)
 * are updated. Service-specific fields (gate_code, logo_url, etc.) are never
 * overwritten.
 *
 * This is the unattended equivalent of pullFromCanonicalAction. Called by
 * /api/cron/canonical-pull on a nightly schedule. The manual admin action
 * remains available for on-demand imports.
 *
 * Env vars required (must match the canonical API):
 *   CANONICAL_API_URL          — defaults to https://core.eq.solutions
 *   CANONICAL_API_KEY_SERVICE  — bearer token for EQ Service
 *   CANONICAL_TENANT_SLUG      — e.g. "sks" (scopes the canonical GET)
 */

import { createAdminClient } from '@/lib/supabase/admin'

const API_URL    = process.env.CANONICAL_API_URL        ?? 'https://core.eq.solutions'
const API_KEY    = process.env.CANONICAL_API_KEY_SERVICE
const API_TENANT = process.env.CANONICAL_TENANT_SLUG    ?? 'sks'
const CHUNK      = 100
const PAGE       = 500

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface CanonicalItem {
  id: string
  external_id?: string
  // customer
  company_name?: string | null
  email?: string | null
  primary_phone?: string | null
  // site
  name?: string | null
  address_line_1?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  country?: string | null
  customer_id?: string | null   // canonical customer UUID
  // asset
  asset_type?: string | null
  site_id?: string | null       // canonical site UUID
  location?: string | null
  manufacturer?: string | null
  make?: string | null          // canonical raw column (asset make)
  model?: string | null
  serial_number?: string | null
  install_date?: string | null
  active?: boolean
  // Per-app assignment flag (canonical customers + sites). Only records
  // explicitly enabled for Service are pulled — keeps the CMMS scoped to
  // maintenance customers, not SKS's full Simpro CRM. Requires the canonical-api
  // to include service_enabled in its projection (eq-shell).
  service_enabled?: boolean
}

interface CanonicalPage {
  ok: boolean
  total: number
  limit: number
  offset: number
  data: CanonicalItem[]
}

export interface CanonicalPullResult {
  tenantId:    string
  customers:   { created: number; updated: number; failed: number }
  sites:       { created: number; updated: number; failed: number }
  assets:      { created: number; updated: number; failed: number }
  instruments: { created: number; updated: number; failed: number }
}

// ──────────────────────────────────────────────────────────────────────────────
// Canonical GET helper
// ──────────────────────────────────────────────────────────────────────────────

async function fetchAll(resource: 'customers' | 'sites' | 'assets'): Promise<CanonicalItem[]> {
  if (!API_KEY) throw new Error('CANONICAL_API_KEY_SERVICE not configured')

  const all: CanonicalItem[] = []
  let offset = 0

  for (;;) {
    const url = new URL(`${API_URL}/.netlify/functions/canonical-api`)
    url.searchParams.set('resource', resource)
    url.searchParams.set('limit',    String(PAGE))
    url.searchParams.set('offset',   String(offset))
    url.searchParams.set('active',   'true')

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'X-Tenant':    API_TENANT,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Canonical ${resource} GET ${res.status}: ${text.slice(0, 200)}`)
    }

    const body: CanonicalPage = await res.json()
    if (!body.ok || !Array.isArray(body.data)) break
    all.push(...body.data)
    if (all.length >= body.total || body.data.length < PAGE) break
    offset += PAGE
  }

  return all
}

// ──────────────────────────────────────────────────────────────────────────────
// Main pull function — resolves tenant by slug, upserts all three resource types
// ──────────────────────────────────────────────────────────────────────────────

export async function pullCanonical(): Promise<CanonicalPullResult> {
  if (!API_KEY) throw new Error('CANONICAL_API_KEY_SERVICE not configured')

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // Resolve the eq-service tenant that corresponds to the canonical slug.
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', API_TENANT)
    .single()

  if (tErr || !tenant) {
    throw new Error(`No tenant found with slug "${API_TENANT}": ${tErr?.message ?? 'no row'}`)
  }

  const tenantId = tenant.id

  // ── 1. Customers ────────────────────────────────────────────────────────────
  const canonicalCustomers = await fetchAll('customers')

  const { data: existingCustomers } = await supabase
    .from('customers')
    .select('id, canonical_id')
    .eq('tenant_id', tenantId)
    .not('canonical_id', 'is', null)

  const canonicalToService = new Map<string, string>(
    (existingCustomers ?? []).map(c => [c.canonical_id as string, c.id as string])
  )

  let customerCreated = 0, customerUpdated = 0, customerFailed = 0

  // Scope to Service-assigned customers only (service_enabled === true). The
  // canonical-api must return service_enabled for this to select anything; until
  // it does, this pull is a safe no-op (nothing matches), and the cron stays
  // gated (CANONICAL_PULL_CRON_ENABLED) regardless.
  const toCreateC = canonicalCustomers.filter(c => c.company_name && c.service_enabled === true && !canonicalToService.has(c.id))
  const toUpdateC = canonicalCustomers.filter(c => c.company_name && c.service_enabled === true &&  canonicalToService.has(c.id))

  for (let i = 0; i < toCreateC.length; i += CHUNK) {
    const chunk = toCreateC.slice(i, i + CHUNK).map(c => ({
      tenant_id:           tenantId,
      name:                c.company_name!,
      email:               c.email ?? null,
      phone:               c.primary_phone ?? null,
      is_active:           true,
      canonical_id:        c.id,
      canonical_synced_at: now,
    }))
    const { data: inserted, error } = await supabase
      .from('customers')
      .insert(chunk)
      .select('id, canonical_id')
    if (error) { customerFailed += chunk.length; continue }
    customerCreated += inserted?.length ?? 0
    for (const row of inserted ?? []) {
      if (row.canonical_id) canonicalToService.set(row.canonical_id as string, row.id as string)
    }
  }

  for (const c of toUpdateC) {
    const serviceId = canonicalToService.get(c.id)!
    const { error } = await supabase
      .from('customers')
      .update({ name: c.company_name!, email: c.email ?? null, phone: c.primary_phone ?? null, canonical_synced_at: now })
      .eq('id', serviceId)
    if (error) { customerFailed++; continue }
    customerUpdated++
  }

  // ── 2. Sites ─────────────────────────────────────────────────────────────────
  const canonicalSites = await fetchAll('sites')

  const { data: existingSites } = await supabase
    .from('sites')
    .select('id, canonical_id')
    .eq('tenant_id', tenantId)
    .not('canonical_id', 'is', null)

  const siteCanonicalToService = new Map<string, string>(
    (existingSites ?? []).map(s => [s.canonical_id as string, s.id as string])
  )

  let siteCreated = 0, siteUpdated = 0, siteFailed = 0

  const toCreateS = canonicalSites.filter(s => s.name && s.service_enabled === true && !siteCanonicalToService.has(s.id))
  const toUpdateS = canonicalSites.filter(s => s.name && s.service_enabled === true &&  siteCanonicalToService.has(s.id))

  for (let i = 0; i < toCreateS.length; i += CHUNK) {
    const chunk = toCreateS.slice(i, i + CHUNK).map(s => ({
      tenant_id:           tenantId,
      name:                s.name!,
      customer_id:         s.customer_id ? (canonicalToService.get(s.customer_id) ?? null) : null,
      address:             s.address_line_1 ?? null,
      city:                s.suburb ?? null,
      state:               s.state ?? null,
      postcode:            s.postcode ?? null,
      country:             s.country ?? undefined,
      is_active:           true,
      canonical_id:        s.id,
      canonical_synced_at: now,
    }))
    const { data: inserted, error } = await supabase
      .from('sites')
      .insert(chunk)
      .select('id, canonical_id')
    if (error) { siteFailed += chunk.length; continue }
    siteCreated += inserted?.length ?? 0
    for (const row of inserted ?? []) {
      if (row.canonical_id) siteCanonicalToService.set(row.canonical_id as string, row.id as string)
    }
  }

  for (const s of toUpdateS) {
    const serviceId = siteCanonicalToService.get(s.id)!
    const { error } = await supabase
      .from('sites')
      .update({
        name:                s.name!,
        address:             s.address_line_1 ?? null,
        city:                s.suburb ?? null,
        state:               s.state ?? null,
        postcode:            s.postcode ?? null,
        canonical_synced_at: now,
      })
      .eq('id', serviceId)
    if (error) { siteFailed++; continue }
    siteUpdated++
  }

  // ── 3. Assets ────────────────────────────────────────────────────────────────
  const canonicalAssets = await fetchAll('assets')

  // plant_equipment assets are SKS's own test tools → route to the instruments
  // register (step 4), not the customer-asset table. All other types are
  // customer site assets. Verified: plant_equipment lives only on the
  // null-customer "SKS — Internal" site, never on a customer site.
  const siteAssets       = canonicalAssets.filter(a => a.asset_type !== 'plant_equipment')
  const instrumentAssets = canonicalAssets.filter(a => a.asset_type === 'plant_equipment')

  const { data: existingAssets } = await supabase
    .from('assets')
    .select('id, canonical_id')
    .eq('tenant_id', tenantId)
    .not('canonical_id', 'is', null)

  const assetCanonicalToService = new Map<string, string>(
    (existingAssets ?? []).map(a => [a.canonical_id as string, a.id as string])
  )

  let assetCreated = 0, assetUpdated = 0, assetFailed = 0

  const toCreateA = siteAssets.filter(
    a => a.name && a.site_id && siteCanonicalToService.has(a.site_id) && !assetCanonicalToService.has(a.id)
  )
  const toUpdateA = siteAssets.filter(a => a.name && assetCanonicalToService.has(a.id))

  for (let i = 0; i < toCreateA.length; i += CHUNK) {
    const chunk = toCreateA.slice(i, i + CHUNK).map(a => ({
      tenant_id:           tenantId,
      site_id:             siteCanonicalToService.get(a.site_id!)!,
      name:                a.name!,
      asset_type:          a.asset_type ?? 'General',
      manufacturer:        a.manufacturer ?? null,
      model:               a.model ?? null,
      serial_number:       a.serial_number ?? null,
      location:            a.location ?? null,
      install_date:        a.install_date ?? null,
      is_active:           a.active !== false,
      canonical_id:        a.id,
      canonical_synced_at: now,
    }))
    const { data: inserted, error } = await supabase
      .from('assets')
      .insert(chunk)
      .select('id')
    if (error) { assetFailed += chunk.length; continue }
    assetCreated += inserted?.length ?? 0
  }

  for (const a of toUpdateA) {
    const serviceId = assetCanonicalToService.get(a.id)!
    const { error } = await supabase
      .from('assets')
      .update({
        name:                a.name!,
        asset_type:          a.asset_type ?? 'General',
        manufacturer:        a.manufacturer ?? null,
        model:               a.model ?? null,
        serial_number:       a.serial_number ?? null,
        location:            a.location ?? null,
        install_date:        a.install_date ?? null,
        canonical_synced_at: now,
      })
      .eq('id', serviceId)
    if (error) { assetFailed++; continue }
    assetUpdated++
  }

  // ── 4. Instruments (canonical plant_equipment) ───────────────────────────────
  // SKS's own test tools live in the instruments register, not the asset table.
  // Matched by canonical_id (migration 0130); not site-bound.
  // instruments.canonical_id is newer than the generated types (0130) — cast
  // until database.types.ts is regenerated (see project_ts_types_stale).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbInstr = supabase as any
  const { data: existingInstruments } = await sbInstr
    .from('instruments')
    .select('id, canonical_id')
    .eq('tenant_id', tenantId)
    .not('canonical_id', 'is', null)

  const instrCanonicalToService = new Map<string, string>(
    ((existingInstruments ?? []) as { id: string; canonical_id: string }[])
      .map(i => [i.canonical_id, i.id])
  )

  let instrCreated = 0, instrUpdated = 0, instrFailed = 0

  const toCreateI = instrumentAssets.filter(a => a.name && !instrCanonicalToService.has(a.id))
  const toUpdateI = instrumentAssets.filter(a => a.name &&  instrCanonicalToService.has(a.id))

  for (let i = 0; i < toCreateI.length; i += CHUNK) {
    const chunk = toCreateI.slice(i, i + CHUNK).map(a => ({
      tenant_id:           tenantId,
      name:                a.name!,
      instrument_type:     a.asset_type ?? 'test_equipment',
      make:                a.make ?? a.manufacturer ?? null,
      model:               a.model ?? null,
      serial_number:       a.serial_number ?? null,
      status:              'active',
      is_active:           a.active !== false,
      canonical_id:        a.id,
      canonical_synced_at: now,
    }))
    const { data: inserted, error } = await sbInstr
      .from('instruments')
      .insert(chunk)
      .select('id')
    if (error) { instrFailed += chunk.length; continue }
    instrCreated += inserted?.length ?? 0
  }

  for (const a of toUpdateI) {
    const serviceId = instrCanonicalToService.get(a.id)!
    const { error } = await sbInstr
      .from('instruments')
      .update({
        name:                a.name!,
        make:                a.make ?? a.manufacturer ?? null,
        model:               a.model ?? null,
        serial_number:       a.serial_number ?? null,
        canonical_synced_at: now,
      })
      .eq('id', serviceId)
    if (error) { instrFailed++; continue }
    instrUpdated++
  }

  return {
    tenantId,
    customers:   { created: customerCreated, updated: customerUpdated, failed: customerFailed },
    sites:       { created: siteCreated,     updated: siteUpdated,     failed: siteFailed     },
    assets:      { created: assetCreated,    updated: assetUpdated,    failed: assetFailed    },
    instruments: { created: instrCreated,    updated: instrUpdated,    failed: instrFailed    },
  }
}
