'use server'

// syncSitesFromFieldAction
//
// Pulls the canonical site list from EQ Field and upserts it locally.
// Field owns sites — this is a one-way pull, never a push.
//
// Match priority:
//   1. canonical_field_id already set → update name + address fields only.
//   2. No canonical_field_id, but site codes match → update + stamp canonical_field_id.
//   3. No match → create new site with canonical_field_id set.
//
// Service-specific fields (gate_code, parking_notes, after_hours_phone,
// safety_notes, photo_url, logo_url*) are never overwritten by this sync —
// they represent data that Service captures on-site and Field doesn't hold.
//
// Field API contract (Field must implement):
//   GET <FIELD_API_URL>/api/eq-service/sites?tenant=<tenantId>
//   Authorization: Bearer <b64-signed-payload>.<hmac-hex>
//   Response: { sites: FieldSite[] }
//
// Auth uses the same HMAC pattern as the Shell bridge (EQ_SECRET_SALT).

import { revalidatePath } from 'next/cache'
import { createHmac } from 'node:crypto'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin } from '@/lib/utils/roles'
import {
  syncCustomer,
  syncSite,
  customerExternalId,
  siteExternalId,
} from '@/lib/canonical-sync'

const FIELD_API_URL = process.env.FIELD_API_URL ?? ''
const EQ_SECRET_SALT = process.env.EQ_SECRET_SALT ?? ''

export interface FieldSite {
  id: string
  name: string
  code: string | null
  customer_name: string | null
  address: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string
  latitude: number | null
  longitude: number | null
}

function mintSyncToken(tenantId: string): string {
  const payload = JSON.stringify({
    kind: 'service-sync',
    tenant_id: tenantId,
    exp: Date.now() + 60_000,
  })
  const b64 = Buffer.from(payload).toString('base64')
  const sig = createHmac('sha256', EQ_SECRET_SALT).update(payload).digest('hex')
  return `${b64}.${sig}`
}

export async function syncSitesFromFieldAction(): Promise<
  | { success: true; created: number; updated: number; message?: string }
  | { success: false; error: string }
> {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    if (!FIELD_API_URL) {
      return { success: false, error: 'FIELD_API_URL is not set on this deployment. Add it to Netlify environment variables.' }
    }
    if (!EQ_SECRET_SALT) {
      return { success: false, error: 'EQ_SECRET_SALT is not set on this deployment.' }
    }

    // Fetch sites from Field
    const token = mintSyncToken(tenantId)
    const res = await fetch(
      `${FIELD_API_URL}/api/eq-service/sites?tenant=${encodeURIComponent(tenantId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      return { success: false, error: `Field API returned ${res.status}: ${text}` }
    }

    const body = await res.json() as { sites?: unknown }
    const fieldSites = Array.isArray(body.sites) ? (body.sites as FieldSite[]) : []

    if (fieldSites.length === 0) {
      return { success: true, created: 0, updated: 0, message: 'Field returned 0 sites — nothing to sync.' }
    }

    // Load existing Service sites for match lookup
    const { data: existingSites } = await supabase
      .from('sites')
      .select('id, canonical_field_id, code, customer_id')
      .eq('tenant_id', tenantId)

    const byFieldId = new Map<string, { id: string; customer_id: string | null }>()
    const byCode = new Map<string, { id: string; customer_id: string | null }>()
    for (const s of existingSites ?? []) {
      if (s.canonical_field_id) byFieldId.set(s.canonical_field_id, { id: s.id, customer_id: s.customer_id })
      if (s.code) byCode.set(s.code, { id: s.id, customer_id: s.customer_id })
    }

    // Resolve / auto-create customers referenced by Field sites
    const { data: allCustomers } = await supabase
      .from('customers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    const customerMap = new Map<string, string>()
    for (const c of allCustomers ?? []) {
      customerMap.set(c.name.toLowerCase(), c.id)
    }

    const missingCustomerNames = [...new Set(
      fieldSites
        .map(s => s.customer_name?.trim())
        .filter((n): n is string => !!n && !customerMap.has(n.toLowerCase())),
    )]
    if (missingCustomerNames.length > 0) {
      const { data: created } = await supabase
        .from('customers')
        .insert(missingCustomerNames.map(name => ({ name, tenant_id: tenantId })))
        .select('id, name')
      for (const c of created ?? []) {
        customerMap.set(c.name.toLowerCase(), c.id)
      }
    }

    const now = new Date().toISOString()
    let created = 0
    let updated = 0

    for (const fs of fieldSites) {
      const customerId = fs.customer_name
        ? (customerMap.get(fs.customer_name.toLowerCase().trim()) ?? null)
        : null

      // Fields that are safe to overwrite from Field
      const syncFields = {
        name: fs.name,
        address: fs.address,
        city: fs.city,
        state: fs.state,
        postcode: fs.postcode,
        country: fs.country || 'Australia',
        latitude: fs.latitude,
        longitude: fs.longitude,
        canonical_field_id: fs.id,
        field_synced_at: now,
      }

      const existing = byFieldId.get(fs.id) ?? (fs.code ? byCode.get(fs.code) : undefined)

      if (existing) {
        await supabase
          .from('sites')
          .update({
            ...syncFields,
            // Only set customer_id if Service hasn't already resolved it
            ...(existing.customer_id ? {} : { customer_id: customerId }),
          })
          .eq('id', existing.id)
        updated++
      } else {
        await supabase
          .from('sites')
          .insert({
            tenant_id: tenantId,
            code: fs.code,
            customer_id: customerId,
            ...syncFields,
          })
        created++
      }
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'site',
      summary: `Synced sites from EQ Field — ${created} created, ${updated} updated`,
    })
    revalidatePath('/sites')

    return { success: true, created, updated }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// backfillCanonicalAction
//
// One-shot admin action. Iterates all active customers and sites that have
// no canonical_id yet, pushes each to the EQ canonical API, and stamps the
// returned UUID back. Already-synced records are skipped.
//
// Returns per-entity counts so the UI can show "Synced 12 customers, 34 sites".
// Partial failures are tracked separately — if canonical is down for 2 sites
// the rest still get synced.
// ─────────────────────────────────────────────────────────────────────────────

export interface BackfillResult {
  success: true
  customers: { synced: number; skipped: number; failed: number }
  sites: { synced: number; skipped: number; failed: number }
}

export async function backfillCanonicalAction(): Promise<
  BackfillResult | { success: false; error: string }
> {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const now = new Date().toISOString()

    // ── 1. Back-fill customers ─────────────────────────────────────────────
    const { data: customers, error: cErr } = await supabase
      .from('customers')
      .select('id, name, email, phone')
      .eq('is_active', true)
      .is('canonical_id', null)

    if (cErr) throw new Error(`Failed to load customers: ${cErr.message}`)

    let customersSynced = 0
    let customersSkipped = 0
    let customersFailed = 0

    for (const c of customers ?? []) {
      const result = await syncCustomer({
        external_id:   customerExternalId(c.id),
        company_name:  c.name,
        email:         c.email ?? undefined,
        primary_phone: c.phone ?? undefined,
        active:        true,
      })

      if (!result.canonical_id) {
        customersFailed++
        continue
      }

      const { error: stampErr } = await supabase
        .from('customers')
        .update({ canonical_id: result.canonical_id, canonical_synced_at: now })
        .eq('id', c.id)

      if (stampErr) {
        console.error('[backfill] failed to stamp customer', c.id, stampErr.message)
        customersFailed++
      } else {
        customersSynced++
      }
    }

    // ── 2. Back-fill sites ─────────────────────────────────────────────────
    const { data: sites, error: sErr } = await supabase
      .from('sites')
      .select('id, name, customer_id, address, city, state, postcode, country')
      .eq('is_active', true)
      .is('canonical_id', null)

    if (sErr) throw new Error(`Failed to load sites: ${sErr.message}`)

    let sitesSynced = 0
    let sitesSkipped = 0
    let sitesFailed = 0

    for (const s of sites ?? []) {
      const result = await syncSite({
        external_id:          siteExternalId(s.id),
        name:                 s.name,
        external_customer_id: s.customer_id ? customerExternalId(s.customer_id) : undefined,
        address_line_1:       s.address ?? undefined,
        suburb:               s.city ?? undefined,
        state:                s.state ?? undefined,
        postcode:             s.postcode ?? undefined,
        country:              s.country ?? undefined,
        active:               true,
      })

      if (!result.canonical_id) {
        sitesFailed++
        continue
      }

      const { error: stampErr } = await supabase
        .from('sites')
        .update({ canonical_id: result.canonical_id, canonical_synced_at: now })
        .eq('id', s.id)

      if (stampErr) {
        console.error('[backfill] failed to stamp site', s.id, stampErr.message)
        sitesFailed++
      } else {
        sitesSynced++
      }
    }

    await logAuditEvent({
      action: 'create',
      entityType: 'customer',
      summary: `Canonical back-fill — ${customersSynced} customers synced, ${sitesSynced} sites synced`,
    })

    // Revalidate the integrations page so coverage bars update immediately.
    revalidatePath('/admin/integrations')

    return {
      success: true,
      customers: { synced: customersSynced, skipped: customersSkipped, failed: customersFailed },
      sites:     { synced: sitesSynced,     skipped: sitesSkipped,     failed: sitesFailed     },
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
