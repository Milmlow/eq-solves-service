/**
 * canonical-reconcile.ts — drift backstop for the canonical reference layer.
 *
 * The outbox (lib/canonical-outbox.ts) makes individual syncs durable, but it
 * can't catch rows that NEVER entered a sync attempt — created before the outbox
 * existed, or where even the enqueue was missed. This sweep finds customers and
 * sites that were never confirmed in canonical (canonical_id IS NULL) and
 * re-syncs them through the durable path (syncCustomer/syncSite — a failure now
 * lands in the outbox). Idempotent: the hub upserts by external_id.
 *
 * Driven daily by /api/cron/reconcile-canonical. Field mappings mirror the
 * create/update server actions exactly (app/(app)/customers|sites/actions.ts).
 *
 * Service-role only: reads/writes via the admin client (bypasses RLS), sweeping
 * across all tenants — Service syncs everything to the single CANONICAL_TENANT_SLUG.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  syncCustomer,
  syncSite,
  customerExternalId,
  siteExternalId,
} from '@/lib/canonical-sync'

export interface ReconcileResult {
  customers: { scanned: number; synced: number }
  sites:     { scanned: number; synced: number }
}

interface CustomerRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  is_active: boolean | null
}

interface SiteRow {
  id: string
  name: string | null
  customer_id: string | null
  address: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string | null
}

export async function reconcileCanonical(limit = 200): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    customers: { scanned: 0, synced: 0 },
    sites:     { scanned: 0, synced: 0 },
  }
  // Cast: canonical_id / canonical_synced_at may not be in the generated
  // Database types yet. Access these tables loosely (run `supabase gen types`
  // to restore full typing).
  const sb = createAdminClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => { is: (col: string, v: null) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } }
      update: (row: Record<string, unknown>) => { eq: (col: string, v: string) => Promise<unknown> }
    }
  }

  // ── Customers ──
  const { data: customers } = await sb.from('customers')
    .select('id, name, email, phone, is_active')
    .is('canonical_id', null)
    .limit(limit)

  for (const c of (customers ?? []) as CustomerRow[]) {
    result.customers.scanned++
    const sync = await syncCustomer({
      external_id:   customerExternalId(c.id),
      company_name:  c.name ?? undefined,
      email:         c.email ?? undefined,
      primary_phone: c.phone ?? undefined,
      active:        c.is_active ?? undefined,
    })
    if (sync.canonical_id) {
      await sb.from('customers')
        .update({ canonical_id: sync.canonical_id, canonical_synced_at: new Date().toISOString() })
        .eq('id', c.id)
      result.customers.synced++
    }
  }

  // ── Sites ── (external_customer_id lets canonical resolve our customer id)
  const { data: sites } = await sb.from('sites')
    .select('id, name, customer_id, address, city, state, postcode, country')
    .is('canonical_id', null)
    .limit(limit)

  for (const s of (sites ?? []) as SiteRow[]) {
    result.sites.scanned++
    const sync = await syncSite({
      external_id:          siteExternalId(s.id),
      name:                 s.name ?? undefined,
      external_customer_id: s.customer_id ? customerExternalId(s.customer_id) : undefined,
      address_line_1:       s.address ?? undefined,
      suburb:               s.city ?? undefined,
      state:                s.state ?? undefined,
      postcode:             s.postcode ?? undefined,
      country:              s.country ?? undefined,
    })
    if (sync.canonical_id) {
      await sb.from('sites')
        .update({ canonical_id: sync.canonical_id, canonical_synced_at: new Date().toISOString() })
        .eq('id', s.id)
      result.sites.synced++
    }
  }

  return result
}
