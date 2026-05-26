/**
 * canonical-sync.ts — EQ Service → canonical write-through adapter
 *
 * Pushes customer and site records to sks-canonical via the canonical-api
 * PUT endpoint whenever EQ Service creates or updates one. The canonical
 * record is the source of truth; EQ Service's local row becomes a write-
 * through cache.
 *
 * Usage (in a Next.js Server Action or API route):
 *
 *   import { syncCustomer, syncSite } from '@/lib/canonical-sync';
 *
 *   // After creating/updating a customer:
 *   const canonical = await syncCustomer({
 *     external_id: `eq-service:${row.id}`,
 *     company_name: row.name,
 *     email: row.email,
 *     ...
 *   });
 *   // canonical.canonical_id — store this in customers.canonical_id
 *
 * Environment variables required (Netlify / local .env.local):
 *   CANONICAL_API_URL          — https://core.eq.solutions (or localhost)
 *   CANONICAL_API_KEY_SERVICE  — bearer key for EQ Service
 *   CANONICAL_TENANT_SLUG      — e.g. "sks"
 *
 * The external_id convention for EQ Service records:
 *   customers: "eq-service:${customer.id}"
 *   sites:     "eq-service:site:${site.id}"
 *
 * This keeps external_id globally unique across source apps without needing
 * namespaced UUIDs.
 */

const API_URL    = process.env.CANONICAL_API_URL    ?? 'https://core.eq.solutions';
const API_KEY    = process.env.CANONICAL_API_KEY_SERVICE;
const TENANT     = process.env.CANONICAL_TENANT_SLUG ?? 'sks';

if (!API_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[canonical-sync] CANONICAL_API_KEY_SERVICE is not set — syncs will be skipped');
}

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface CanonicalSyncResult {
  canonical_id: string;
  created:      boolean;
}

interface CanonicalApiOkResponse {
  ok:           true;
  canonical_id: string;
  created:      boolean;
}

interface CanonicalApiErrResponse {
  ok:     false;
  error:  string;
  detail?: string;
}

// Writable customer fields (subset — only what EQ Service tracks).
export interface CustomerSyncInput {
  external_id:    string;          // required, e.g. "eq-service:12"
  company_name?:  string;
  email?:         string;
  primary_phone?: string;
  mobile_phone?:  string;
  suburb?:        string;
  state?:         string;
  postcode?:      string;
  country?:       string;
  active?:        boolean;
}

// Writable site fields (subset).
export interface SiteSyncInput {
  external_id:         string;    // required, e.g. "eq-service:site:99"
  name?:               string;
  client_name?:        string;
  site_type?:          string;
  customer_id?:        string;    // canonical customer UUID (if known)
  external_customer_id?: string;  // e.g. "eq-service:12" — used when canonical customer_id unknown
  address_line_1?:     string;
  suburb?:             string;
  state?:              string;
  postcode?:           string;
  country?:            string;
  site_contact_name?:  string;
  site_contact_phone?: string;
  site_contact_email?: string;
  active?:             boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Core request helper
// ──────────────────────────────────────────────────────────────────────

async function putCanonical(
  resource: 'customers' | 'sites',
  payload:  CustomerSyncInput | SiteSyncInput,
): Promise<CanonicalSyncResult> {
  if (!API_KEY) {
    // Not configured — skip silently in dev, warn in prod (guarded above).
    return { canonical_id: '', created: false };
  }

  const url = `${API_URL}/.netlify/functions/canonical-api`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'X-Tenant':      TENANT,
      },
      body: JSON.stringify({ resource, ...payload }),
    });
  } catch (e) {
    // Network error — log and return empty so caller can continue
    console.error('[canonical-sync] network error', { resource, error: (e as Error).message });
    return { canonical_id: '', created: false };
  }

  let body: CanonicalApiOkResponse | CanonicalApiErrResponse;
  try {
    body = await res.json() as CanonicalApiOkResponse | CanonicalApiErrResponse;
  } catch {
    console.error('[canonical-sync] non-JSON response', { resource, status: res.status });
    return { canonical_id: '', created: false };
  }

  if (!res.ok || !body.ok) {
    const errBody = body as CanonicalApiErrResponse;
    console.error('[canonical-sync] API error', {
      resource,
      status:  res.status,
      error:   errBody.error,
      detail:  errBody.detail,
    });
    // Non-throwing — caller decides whether to retry or surface the error
    return { canonical_id: '', created: false };
  }

  return {
    canonical_id: (body as CanonicalApiOkResponse).canonical_id,
    created:      (body as CanonicalApiOkResponse).created,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

/**
 * Push a customer upsert to canonical. Call after every customer create/update.
 *
 * Returns the canonical_id to store in customers.canonical_id, or an empty
 * string if the sync was skipped (no API key) or failed (network / API error).
 * Failures are logged but not thrown — EQ Service continues to work even if
 * canonical is unreachable.
 */
export async function syncCustomer(input: CustomerSyncInput): Promise<CanonicalSyncResult> {
  return putCanonical('customers', input);
}

/**
 * Push a site upsert to canonical. Call after every site create/update.
 */
export async function syncSite(input: SiteSyncInput): Promise<CanonicalSyncResult> {
  return putCanonical('sites', input);
}

/**
 * Build the standard external_id for an EQ Service customer.
 * Always prefix with "eq-service:" to avoid collisions with EQ Quotes IDs.
 */
export function customerExternalId(serviceCustomerId: string | number): string {
  return `eq-service:${serviceCustomerId}`;
}

/**
 * Build the standard external_id for an EQ Service site.
 */
export function siteExternalId(serviceSiteId: string | number): string {
  return `eq-service:site:${serviceSiteId}`;
}
