# Proposal — Canonical ↔ Service tenant identity reconciliation

**Status:** DRAFT for review · **2026-06-04** · **Blast radius:** auth / tenant isolation
**Related:** PR #236 (auto-provision, held), the Shell SSO cookie path
**Repos:** `eq-solves-service`, `eq-shell` (+ canonical control plane)

## Problem

The Shell cookie SSO now logs a user into Service (double-login fixed), but a
user with no `tenant_members` row lands on "No tenant assigned" and can't
self-fix (the admin UI is behind the same gate). The obvious fix — provision
`tenant_members` from the cookie's `memberships` — is **unsafe today** because
the canonical/Shell and Service tenant registries are not reconciled.

### Evidence (live DB, 2026-06-04)

| Org | Canonical id (in `eq_shell_session`) | Canonical slug | Service `tenants.id` | Service slug |
|---|---|---|---|---|
| SKS Technologies | `00000000-…-002` | `sks` | `ccca00fc-…` | `sks` |
| EQ Solutions | `a0000000-…-001` | `eq` | *(none)* | — |
| Demo | `00000000-…-003` | `demo-trades` | `a0000000-…-001` | `demo-electrical` |
| Melbourne Construction Group | `00000000-…-004` | `melbourne` | *(none)* | — |

Two independent problems:

1. **Separate id spaces + a UUID collision.** Canonical **EQ Solutions** and
   Service **Demo Electrical** share the *exact same* id `a0000000-…-001`. Any
   code that carries a canonical `tenant_id` into Service as if it were a
   `tenants.id` will mis-route — an EQ Solutions member would resolve to Demo
   Electrical. (This is precisely what PR #236's id-based mapping would have
   done; it's held for this reason.)

2. **Slugs don't fully align, and Service is missing tenants.** Only `sks`
   matches on both sides. Canonical `demo-trades` ≠ Service `demo-electrical`,
   and Service has no `eq` or `melbourne` tenant at all.

### Why there's no live data leak (yet)

Service scopes all access by its **own** `tenant_members` + RLS
(`get_user_tenant_ids()`), **not** by the cookie's `tenant_id`. A user with no
membership simply hits the gate. The collision only becomes harmful the moment
something *writes* Service rows keyed off a canonical id — e.g. auto-provision.
So the guardrail is: **never treat a canonical `tenant_id` as a Service
`tenants.id`.**

## Proposed approach

**Principle: `slug` is the only cross-app tenant key. Raw `tenant_id` is
app-local and must never cross the boundary.**

1. **Make slugs the contract, and reconcile them.**
   - Decide one canonical slug per org. Resolve `demo-trades` vs
     `demo-electrical` (pick one; rename the other).
   - Create the missing Service tenants where EQ intends Service access —
     starting with **`eq`** (EQ Solutions) so EQ staff have a home in Service.
     (`melbourne` only if/when it onboards to Service.)

2. **Carry the slug in the session cookie (Shell change).**
   `eq_shell_session` currently carries `tenant_id` + `memberships:[{tenant_id,
   role}]` but **no slug**. Add the active tenant's slug (and per-membership
   slug) to the cookie payload so Service can map without a cross-DB lookup.
   The short-lived iframe/bridge token already carries `tenant_slug`; extend the
   same to the session payload.

3. **Provision by slug, not id (reworks PR #236).**
   On SSO, for each cookie membership: look up Service `tenants` **by slug**,
   and upsert `tenant_members(user_id, <service tenant id>, role)`. Skip slugs
   with no Service tenant. No id ever crosses the boundary → collision is
   irrelevant. Keep the existing safeguards: ignore `is_platform_admin`,
   canonical `EqRole` stored directly, non-clobbering, best-effort.

4. **Audit for raw cross-boundary id use.** The Shell `token.ts` comment says
   downstream apps "read `session.tenant_id` directly." Grep Field and Service
   for any place that compares/stores the cookie `tenant_id` against a local
   `tenants.id`. Given the collision, any such site is a latent cross-tenant
   bug. Convert to slug-based resolution.

## Rollout (each step reversible, no auto-grant until the end)

1. Create Service `eq` tenant; assign EQ staff (manual) → unblocks EQ now.
2. Reconcile the demo slug mismatch.
3. Shell: add slug(s) to `eq_shell_session`. Additive; old cookies treated as
   "no slug" → no provisioning (status quo).
4. Service: rework #236 to map by slug; verify with a pilot user; then enable.
5. Audit + fix any raw `tenant_id` cross-boundary usage.

## Open questions

- **Registry source of truth.** Is canonical the master tenant registry the
  whole suite should mirror (Service tenants become projections keyed by slug)?
  Or do apps keep independent registries joined only by slug? This decides
  whether Service should also adopt canonical ids over time (and retire the
  collision) vs. just mapping by slug forever.
- **Demo naming.** `demo-trades` vs `demo-electrical` — which wins?
- **EQ tenant scope.** Is the Service `eq` tenant a dogfooding/dev sandbox for
  EQ staff (recommended), and should it be excluded from customer-facing
  metrics/reports?
- **Should `is_platform_admin` ever grant Service access?** Current answer (C6):
  no — cross-tenant power is the service-role channel. Confirm this holds.
