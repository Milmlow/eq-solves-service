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

// Writable asset fields (PPM extension).
export interface AssetSyncInput {
  external_id:          string;   // required, e.g. "eq-service:asset:123"
  name?:                string;
  asset_type?:          string;
  external_site_id?:    string;   // e.g. "eq-service:site:99"
  location?:            string;
  manufacturer?:        string;
  model?:               string;
  serial_number?:       string;
  install_date?:        string;   // ISO date
  condition?:           string;
  criticality?:         string;
  ppm_frequency?:       string;
  active?:              boolean;
}

// Test result sync — fired when any test (RCD, ACB, NSX, test_record) saves.
export interface TestResultSyncInput {
  external_id:         string;    // required, e.g. "eq-service:rcd_test:abc"
  external_asset_id?:  string;    // e.g. "eq-service:asset:123"
  test_type:           string;    // "rcd" | "acb" | "nsx" | "thermal" | …
  test_date?:          string;    // ISO date
  pass_fail?:          'pass' | 'fail' | 'pending';
  tested_by_name?:     string;
  notes?:              string;
}

// Defect sync — fired when a defect is raised or updated.
export interface DefectSyncInput {
  external_id:         string;    // required, e.g. "eq-service:defect:abc"
  external_asset_id?:  string;    // e.g. "eq-service:asset:123"
  external_site_id?:   string;    // e.g. "eq-service:site:99"
  title?:              string;
  description?:        string;
  severity?:           string;
  status?:             string;
  raised_date?:        string;    // ISO date
  estimated_cost?:     number;
}

// ──────────────────────────────────────────────────────────────────────
// Core request helper
// ──────────────────────────────────────────────────────────────────────

// A failure worth retrying: transient / server-side. Permanent 4xx (bad
// request, auth, forbidden, not-found) will never succeed on replay, so it is
// logged and dropped rather than queued. Mirrors isRetryableHttpStatus in
// lib/canonical-outbox.ts (duplicated to keep that server-only module — and its
// admin client — out of any client bundle that imports the pure helpers below).
function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

// Persist a PUT to the durable outbox when its inline attempt fails transiently,
// so a canonical outage can't silently drop the write. Dynamically imported so
// the server-only admin client is never pulled into a client bundle.
async function enqueuePut(
  resource: string,
  payload: Record<string, unknown> & { external_id?: string },
): Promise<void> {
  const externalId = typeof payload.external_id === 'string' ? payload.external_id : null;
  const { enqueueCanonicalOutbox } = await import('@/lib/canonical-outbox');
  await enqueueCanonicalOutbox({
    method:    'PUT',
    resource,
    body:      { resource, ...payload },
    externalId,
    dedupeKey: externalId ? `${resource}:${externalId}` : null,
  });
}

async function putCanonical(
  resource: 'customers' | 'sites' | 'assets' | 'asset_test_results' | 'asset_defects',
  payload:  CustomerSyncInput | SiteSyncInput | AssetSyncInput | TestResultSyncInput | DefectSyncInput,
): Promise<CanonicalSyncResult> {
  if (!API_KEY) {
    // Not configured — skip silently in dev, warn in prod (guarded above).
    return { canonical_id: '', created: false };
  }

  const url = `${API_URL}/.netlify/functions/canonical-api`;
  const queueable = payload as Record<string, unknown> & { external_id?: string };

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
    // Network error — transient. Persist to the outbox for retry, don't drop.
    console.error('[canonical-sync] network error — queued for retry', { resource, error: (e as Error).message });
    await enqueuePut(resource, queueable);
    return { canonical_id: '', created: false };
  }

  let body: CanonicalApiOkResponse | CanonicalApiErrResponse;
  try {
    body = await res.json() as CanonicalApiOkResponse | CanonicalApiErrResponse;
  } catch {
    // Non-JSON (gateway / proxy blip) — treat as transient, queue for retry.
    console.error('[canonical-sync] non-JSON response — queued for retry', { resource, status: res.status });
    await enqueuePut(resource, queueable);
    return { canonical_id: '', created: false };
  }

  if (!res.ok || !body.ok) {
    const errBody = body as CanonicalApiErrResponse;
    if (isRetryableHttpStatus(res.status)) {
      console.error('[canonical-sync] API error — queued for retry', {
        resource, status: res.status, error: errBody.error, detail: errBody.detail,
      });
      await enqueuePut(resource, queueable);
    } else {
      // Permanent 4xx (bad request / auth / forbidden) — replay won't help.
      console.error('[canonical-sync] API error — not retryable, dropped', {
        resource, status: res.status, error: errBody.error, detail: errBody.detail,
      });
    }
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
 * Push an asset upsert to canonical. Call after asset create/update.
 * Fire-and-forget pattern: `void syncAsset({ ... })` — never throws,
 * never blocks the caller. Failures are logged to console.
 */
export async function syncAsset(input: AssetSyncInput): Promise<CanonicalSyncResult> {
  return putCanonical('assets', input);
}

/**
 * Push a test result upsert to canonical. Call when a test is saved as
 * complete (RCD, ACB, NSX, or generic test_record).
 * Fire-and-forget: `void syncTestResult({ ... })`
 */
export async function syncTestResult(input: TestResultSyncInput): Promise<CanonicalSyncResult> {
  return putCanonical('asset_test_results', input);
}

/**
 * Push a defect upsert to canonical. Call when a defect is raised or
 * status-updated. Fire-and-forget: `void syncDefect({ ... })`
 */
export async function syncDefect(input: DefectSyncInput): Promise<CanonicalSyncResult> {
  return putCanonical('asset_defects', input);
}

// ──────────────────────────────────────────────────────────────────────
// Event emission — fire-and-forget canonical activity log
// ──────────────────────────────────────────────────────────────────────

/**
 * Emit a canonical activity event. Fire-and-forget — never throws, never
 * blocks the caller. Failures are logged but swallowed so EQ Service
 * continues working even if canonical is unreachable.
 *
 * Events emitted from EQ Service:
 *   defect.created              — when a defect is raised
 *   maintenance_check.completed — when a check is marked complete
 *   maintenance_check.overdue   — when an overdue check is detected on page load;
 *                                 payload: { check_id, site_id, site_name, check_name, days_overdue }
 */
export async function emitEvent(
  event:   string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!API_KEY) return;

  try {
    const res = await fetch(`${API_URL}/.netlify/functions/canonical-api`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'X-Tenant':      TENANT,
      },
      body: JSON.stringify({ resource: 'events', event, payload }),
    });
    if (!res.ok) {
      if (isRetryableHttpStatus(res.status)) {
        console.error('[canonical-sync] emitEvent non-ok — queued for retry', { event, status: res.status });
        await enqueueEvent(event, payload);
      } else {
        console.error('[canonical-sync] emitEvent non-ok — not retryable, dropped', { event, status: res.status });
      }
    }
  } catch (e) {
    // Network error — transient. Persist to the outbox for retry, don't drop.
    console.error('[canonical-sync] emitEvent failed — queued for retry', { event, error: (e as Error).message });
    await enqueueEvent(event, payload);
  }
}

// Persist an event POST to the durable outbox when its inline attempt fails
// transiently. Events have no dedupe key (each is distinct). Dynamically
// imported (server-only admin client kept out of client bundles).
async function enqueueEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  const { enqueueCanonicalOutbox } = await import('@/lib/canonical-outbox');
  await enqueueCanonicalOutbox({
    method:    'POST',
    resource:  'events',
    body:      { resource: 'events', event, payload },
    event,
    dedupeKey: null,
  });
}

// ──────────────────────────────────────────────────────────────────────
// External-ID helpers
// ──────────────────────────────────────────────────────────────────────

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

/**
 * Build the standard external_id for an EQ Service asset.
 */
export function assetExternalId(serviceAssetId: string | number): string {
  return `eq-service:asset:${serviceAssetId}`;
}

/**
 * Build the standard external_id for an RCD test.
 */
export function rcdTestExternalId(testId: string | number): string {
  return `eq-service:rcd_test:${testId}`;
}

/**
 * Build the standard external_id for an ACB test.
 */
export function acbTestExternalId(testId: string | number): string {
  return `eq-service:acb_test:${testId}`;
}

/**
 * Build the standard external_id for an NSX test.
 */
export function nsxTestExternalId(testId: string | number): string {
  return `eq-service:nsx_test:${testId}`;
}

/**
 * Build the standard external_id for a generic test record.
 */
export function testRecordExternalId(testId: string | number): string {
  return `eq-service:test_record:${testId}`;
}

/**
 * Build the standard external_id for a defect.
 */
export function defectExternalId(defectId: string | number): string {
  return `eq-service:defect:${defectId}`;
}
