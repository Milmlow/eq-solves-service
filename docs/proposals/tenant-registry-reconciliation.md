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

## DECISIONS (2026-06-04, after a 10-agent steelman of A/B/C/D)

The steelman's load-bearing finding: the twice-reverted auto-routing was an
**access** failure (silent auto-grant from cross-app claims), not an **identity**
failure. Conflating the two is the trap. So the decision splits on two axes,
chosen independently:

**1 — Identity mechanism → SLUG as the cross-app join key.**
`sks` and `eq` already match across both systems; only `demo` drifts. Slug
dissolves the collision and *finishes* the already-merged `shell-provision.ts`
rather than replacing it with the riskier `canonical_tenant_id` column. Resolve
canonical→Service **once** at provision time and store Service's own local id;
the cookie is never a per-request authorization key. (The `canonical_tenant_id`
column and a live directory service are **deferred** — neither is needed now and
both add irreversible coupling. The "is canonical the master registry" question
is intentionally left open.)

**2 — Access policy → EXPLICIT/INVITE by default, with a per-tenant opt-in.**
Honours the revert. Auto-provision is **off** by default; it becomes a
per-tenant opt-in (`tenant_settings.allow_sso_autoprovision`) enabled only for
verified-1:1 tenants (`sks`, `eq`), never for the colliding/demo tenants, and
only after the safety hardening below.

**Supporting decisions:**
- **Dead gate → replaced** with a "Request access to <resolved tenant>" screen
  that creates a *pending request*, not a membership.
- **Demo slug → align Service to canonical `demo-trades`** (canonical is upstream).
- **Slug immutability → enforced** (rename-lockout + tombstone) as part of the
  reconciliation, before any manual-attach campaign or auto-provision.
- **Shell cookie slug → sequenced last**, under explicit Royce approval (auth change).
- **SKS go-live (2026-06-21) → service-role seed runbook + pre-attach known techs.**
- **`is_platform_admin` → still never grants tenant access** (C6 holds).
- **EQ tenant → a dogfooding/dev sandbox** for EQ staff.

### Hardening required BEFORE `allow_sso_autoprovision` can be enabled
The merged `shell-provision.ts` is a safe no-op today but is NOT activation-ready:
- It swallows all errors and writes **no `audit_logs`** row — violates the repo's
  "audit every mutation" invariant. Add provenance (`source='shell_sso'` + `mutation_id`).
- It takes the **role verbatim** from the cookie (`manager`/admin would pass).
  Clamp to a Service-side allowlist; never auto-grant admin from a claim; default lowest.
- Gate the whole writer behind `tenant_settings.allow_sso_autoprovision` (default false).

### Build order (minimum-first)
1. **Now:** EQ tenant (done) + EQ staff invited; replace the dead gate with the
   request-access screen; harden the provisioning code (inert, but review-ready).
2. Reconcile the `demo` slug + add slug immutability guard.
3. Audit Field/Quotes/Shell for any raw cookie-`tenant_id` vs local-`tenants.id` use.
4. SKS go-live seed runbook + pre-attach.
5. **Last, with approval:** Shell adds slug to `eq_shell_session`; enable
   `allow_sso_autoprovision` for `sks`/`eq` only after a soak.
