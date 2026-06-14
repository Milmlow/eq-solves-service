import { createAdminClient } from '@/lib/supabase/admin'
import type { ServiceJwtClaims } from '@/lib/auth/service-jwt'

// ── Phase 1 identity convergence (docs/sprint-identity-convergence.md) ────────
//
// Master app-side switch for the federated (claims-based) identity path. OFF by
// default. Flipping it on requires, IN LOCKSTEP, the DB flag
// `public.identity_rollout.claims_enabled` (migration 0131) AND a clean
// shadow-run — see the sprint Rigor track. With this OFF, every path that reads
// it is byte-for-byte the legacy behaviour, so deploying changes nothing.
//
// NOT marked 'use server' — a plain server-side module imported by the auth
// helpers, never a public RPC surface.
export const IDENTITY_CLAIMS_ENABLED = process.env.IDENTITY_CLAIMS_ENABLED === 'true'

/**
 * Resolve the Service tenant id for a federated (Shell-minted) JWT session.
 *
 * When IDENTITY_CLAIMS_ENABLED: map `app_metadata.tenant_slug` →
 * `public.tenants.id`. Canonical and Service use DIFFERENT tenant-ID namespaces
 * (and the ids can collide across registries), so we NEVER trust the raw
 * `app_metadata.tenant_id` claim as a Service `tenants.id` — we look it up by
 * slug. This mirrors the SQL helper `_claim_service_tenant_id()` in migration
 * 0131, keeping the app and RLS resolving identity the same way.
 *
 * When OFF: returns the raw `tenant_id` claim unchanged (legacy behaviour).
 *
 * Returns `null` when unresolved (no slug, or slug maps to no active tenant) —
 * callers then fall through to the standard session path.
 */
export async function resolveFederatedTenantId(
  claims: ServiceJwtClaims,
): Promise<string | null> {
  if (!IDENTITY_CLAIMS_ENABLED) {
    return claims.app_metadata?.tenant_id ?? null
  }
  const slug = claims.app_metadata?.tenant_slug
  if (!slug) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}
