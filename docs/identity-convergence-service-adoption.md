# Service identity convergence — adopt the suite federation model

**Status: DESIGN (for review). No code yet. Auth-core change — Royce sign-off required before build.**
Date: 2026-06-14.

## TL;DR

The correct way to make Service work via the Shell is **not** a new bridge. It's to stop Service being
its own identity island and make it follow the **federation pattern the suite already decided on and
that EQ Field already runs in production**. Service is the only app still minting its own users and
re-signing its own tokens. Everything that broke tonight (blank settings, failed logo upload, the
supervisor-vs-manager role split, the bogus onboarding wizard) is a direct symptom of that one
deviation.

This is adoption of an existing decision, not invention.

## The decision is already made (eq-context)

- **`eq-context/eq/identity/IDENTITY-MODEL.md`** (v1, live, 2026-05-20) — canonical spec.
  Core principle: *"A user signs in once at `<tenant>.eq.solutions`. From that moment their identity
  — who they are, what role they hold, what modules they can touch — is the same across every EQ
  product for the life of that session."* RLS reads `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`
  and `eq_role`.
- **`eq-context/eq/identity/identity-convergence-target-2026-06-04.md`** — **authorised by Royce
  2026-06-04.** Canonical identity home = `shell_control.{users, user_tenant_memberships}` on
  **eq-canonical (`jvknxcmbtrfnxfrwfimn`)**. `auth.users` = transport-only/disposable. Retire
  `public.org_memberships` and `public.profiles`.

## How identity works in the suite today (the reference pattern)

- **Issuer:** eq-shell `netlify/functions/token-exchange.ts` mints a Supabase-format JWT, **signed
  with eq-canonical's `SUPABASE_JWT_SECRET`** (`_shared/supabase-jwt.ts`). Claims:
  `sub`, `role: "authenticated"`, `aud: "authenticated"`,
  `app_metadata.{ tenant_id, eq_role, is_platform_admin, source_app, email, tenant_slug }`.
- **EQ Field = the proven verifier.** Field has its **own** Supabase project (`nspbmirochztcjijmcrx`
  for SKS) but **does not re-mint**. Its project shares the canonical `SUPABASE_JWT_SECRET`, so it
  **accepts the Shell-issued JWT natively**; its RLS reads `tenant_id` + `eq_role` straight from
  `app_metadata`. One issuer, many verifiers, one shared signing secret. That's the whole model.
- **Federation, not a shared database.** Apps keep their own data projects; they just trust the same
  signed identity. (eq-shell `netlify.toml` `connect-src` lists the 5 topology projects — jvkn, zaap,
  ehow, ktmj, nspb — and `frame-src` already allows `service.eq.solutions` and
  `eq-solves-service.netlify.app`.)

## Where Service deviates today (= the bug list)

| Service does this | The suite/Field does this | Symptom it caused |
|---|---|---|
| **Re-mints** the Shell JWT (`mintServiceJwt`) into a separate `eq_service_jwt` cookie | Verifies the Shell JWT as-is | Storage/RLS reject the re-minted token; logo upload fails |
| Runs its **own `auth.users`** (16) + **own `tenant_members`** (11 active) | Identity lives once in `shell_control` | Role drift: Shell says *supervisor*, Service says *manager* |
| **Dual auth paths** — `createClient()` cookie session vs `requireUser()` JWT path | One path: trust the Shell JWT | In-Shell, cookie reads see no user → defaults ("EQ Solves"), empty workspace, dead Skip |
| RLS via `get_user_*()` over local `tenant_members` keyed by Service's own uids | RLS over `app_metadata` claims | Canonical identity can't satisfy Service's RLS |
| Project (`urjhmkhbgaxrofurpbgc`) has its **own JWT secret**, not in the topology/CSP | Topology projects share the canonical secret | eq-service origin not trusted; calls blocked |

Current scope to converge (live, 2026-06-14): **16 `auth.users`, 11 active memberships, 3 tenants.**
Tiny — this is the cheap window. After SKS's team onboards (21 Jun) and more tenants land, this becomes
a downtime-and-relogin migration.

## Target design for Service (mirror Field)

1. **Bring `urjh` into the federation.** Set eq-service's project JWT secret to the **shared
   canonical `SUPABASE_JWT_SECRET`** so its GoTrue/PostgREST/Storage accept Shell-issued JWTs
   natively. ⚠️ This reissues `urjh`'s anon/service_role keys (they're JWTs signed by that secret) —
   Service's Netlify env keys must be rotated in lockstep. This is the pivotal, careful step; it's
   exactly how Field's `nspb` is already configured, so it's proven, not novel.
2. **Re-point the two RLS helpers, not the policies.** Rewrite `get_user_tenant_ids()` and
   `get_user_role()` (SECURITY DEFINER) to read from `auth.jwt() -> 'app_metadata'`
   (`tenant_id`, `eq_role`) — with `tenant_members` as a transition fallback. **Every existing RLS
   policy then converges with zero policy rewrites**, and the `logos` storage check
   (`auth.role() = 'authenticated'`) passes because the Shell JWT already carries `role:authenticated`.
3. **Delete the parallel machinery.** Remove `mintServiceJwt` + the re-mint, the `requireUser()` JWT
   fast-path, the JWT branch in `app/(app)/layout.tsx`, and `createJwtClient`. One path:
   validate the Shell JWT → use its claims. (This *deletes* code; the correct version is smaller.)
4. **Identity source of truth = `shell_control`.** Role comes from the `eq_role` claim. Service's
   `tenant_members` stops being authoritative — retire it or keep as a read cache. Onboarding/“no
   tenant” gates key off claims (matching Field), which also kills the false onboarding wizard.
5. **CSP/topology.** Confirm whether in-Shell Service is a real cross-origin iframe (its own
   `service.eq.solutions` CSP applies) or a path proxied under `core.eq.solutions` (Shell CSP
   applies). If the latter, add `urjh` to eq-shell `connect-src`. (eq-shell change.)

## User re-key / cutover (small)

1. Reconcile Service's **11 active members** into `shell_control.users` by email (the suite pool has
   only 5 today — net-new canonical users for any Service member not present).
2. Map `shell_control.user_tenant_memberships` to carry each member's `eq_role` for their tenant
   (e.g. royce.milmlow@sks.com.au → SKS → `manager`, fixing the supervisor drift at source).
3. Flip Service to claims-based identity (steps 1–4 above) behind the federation secret swap.
4. Verify: in-Shell — settings show SKS branding, logo upload works, role reads `manager`, no
   onboarding wizard. Direct login still works (it's now the canonical login too). Re-check the
   MFA/AAL path (regression-prone — see CLAUDE.md / proxy.ts).

## Rollback

The secret swap (step 1) is the high-risk gate. Stage on a Supabase branch / preview first. Keep the
old `tenant_members`-based helper bodies behind a feature switch so RLS can fall back if claims-based
auth misbehaves. Don't retire `tenant_members` data until a soak period passes.

## Sequencing — do NOT big-bang

- **Now: identity convergence (this doc).** Service joins the federation; data stays in `urjh`.
  Mirrors how Field keeps `nspb` while trusting canonical identity.
- **Later: data into the topology.** Eventually `urjh` retires and Service's tenant data moves to the
  tenant data plane (the larger canonical migration —
  see memory `project_eq_service_canonical_full_migration`). Identity-first makes this cleaner.

## Open questions to confirm before code

- Exact mechanics + blast radius of the `urjh` JWT-secret swap (key reissue, session invalidation
  window). Mirror Field's `nspb` setup precisely.
- Iframe-origin vs proxied-path for in-Shell Service (decides whether the CSP change is needed).
- Whether to retire Service `tenant_members` or keep it as a cache during transition.
- `is_platform_admin` is dropped for `aud=service` by the Shell (no cross-tenant escalation) —
  confirm Service has no flow that needs it.

## References
- eq-context: `eq/identity/IDENTITY-MODEL.md`, `eq/identity/identity-convergence-target-2026-06-04.md`,
  `cross-app-linkage-audit-2026-06-07.md`
- eq-shell: `netlify/functions/token-exchange.ts`, `netlify/functions/_shared/supabase-jwt.ts`, `netlify.toml`
- Field (reference): `sks-nsw-labour/netlify/functions/verify-pin.js`
- This repo: `lib/auth/service-jwt.ts`, `lib/supabase/server.ts`, `lib/actions/auth.ts`,
  `app/(app)/layout.tsx`, and `docs/shell-service-embed-gaps-2026-06-14.md`
