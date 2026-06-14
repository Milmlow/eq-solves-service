# Shell → Service embed: integration gaps (2026-06-14)

**Status: PARKED.** Captured for a deliberate later sprint. Nothing here blocks SKS go-live —
branding is already stored and reports render correctly. This is a polish/integration gap, not a
data problem.

## Summary

Opening EQ Service **through the Shell** (`core.eq.solutions/sks/service`) lands the user in a
half-built state: the Shell hands Service a **canonical-shaped identity** (JWT claims, role from the
Shell, pointed at the canonical Supabase projects), but Service's data, auth and storage all live in
**its own** project (`urjhmkhbgaxrofurpbgc`). That canonical identity cannot authenticate against
Service's own database, so writes and session-bound reads fail.

The JWT fast-path in `app/api/shell-auth/route.ts` and the JWT branch in `app/(app)/layout.tsx` were
built for the **end-state** where Service reads from canonical (ehow). Its own comment says it "skips
the DB lookup entirely" because "ehow has no tenant_members." That end-state isn't built yet — see
[[project_eq_service_canonical_full_migration]].

Direct login (`service.eq.solutions`, signed in normally, **no** Shell cookies) is unaffected and
works end-to-end. That's how the existing SKS logos were uploaded.

## Symptoms observed (2026-06-14)

- Workspace Settings shows Company Name **"EQ Solves"** (the hardcoded default in
  `lib/tenant/getTenantSettings.ts`), not the stored value — i.e. the page resolved no tenant.
- Logo upload fails: `new row violates row-level security policy` (storage `logos` bucket).
- Console: `EQ[auth] shell-token accepted for Royce Milmlow (supervisor)` — role **supervisor**,
  while eq-service `tenant_members` has him as **manager**.
- CSP error: `connect-src` allows `jvknxcmbtrfnxfrwfimn` (eq-canonical) but **not**
  `urjhmkhbgaxrofurpbgc` (eq-service).
- Clearing cookies / using `service.eq.solutions` directly did **not** help — the Shell cookies are
  scoped to `*.eq.solutions`, so they follow across subdomains and keep the broken bridge session.

## Root cause

One gap, four symptoms: **the Shell handoff never establishes a real eq-service Supabase session.**
The `jwtClaims` fast-path (`route.ts` ~L221–243) sets only `eq_service_jwt` + `eq_shell_bridge`
cookies — no `generateLink`/`verifyOtp`, so no `sb-` session. Therefore:

- `createClient()` (cookie session) server components — `getTenantSettings`, the layout's primary
  branch — see no user → defaults / blank.
- `requireUser()` (server actions) takes the JWT path → `createJwtClient` Bearer-auth against
  eq-service. Whether eq-service even *accepts* that token depends on `EQ_SERVICE_JWT_SECRET`
  matching the project secret, and `auth.uid()` (= JWT `sub`, a canonical user id) matching an
  eq-service `tenant_members.user_id` — both unverified and likely **not** aligned cross-project.

## The four gaps

| # | Gap | Evidence | Where it lives |
|---|-----|----------|----------------|
| 1 | Fast-path sets no Supabase session → session-bound reads see no user → defaults | Company name = "EQ Solves" | `app/api/shell-auth/route.ts`, `app/(app)/layout.tsx`, `lib/tenant/getTenantSettings.ts` |
| 2 | Role sourced from Shell claim (`supervisor`), not eq-service `tenant_members` (`manager`) | Console `shell-token accepted … (supervisor)` | Shell token-exchange + `route.ts` role handling |
| 3 | Shell CSP `connect-src` omits eq-service's Supabase origin → browser client blocked | CSP console error | **eq-shell** repo (CSP for core.eq.solutions) |
| 4 | Storage/RLS won't accept the canonical identity → upload denied | `new row violates row-level security policy` on `logos` | eq-service storage RLS + the session gap above |

Prior partial fix: PR #291 (merged, deployed) added `role: 'authenticated'` to `mintServiceJwt` — a
correct prerequisite, but insufficient on its own because the bridge never establishes a real session
and the cross-project identity/secret alignment is unconfirmed.

## Road A — mint a real Service session at the handoff (recommended, near-term)

Make Service-in-Shell behave like the direct login that already works, **without** a data migration.

1. **eq-service** — in `app/api/shell-auth/route.ts`, stop using the JWT cookie fast-path for
   Service; always run the `generateLink → email_otp → verifyOtp` exchange so the user gets a genuine
   eq-service `sb-` session (eq-service's own `auth.uid()`, role from `tenant_members`). Keep the
   `tenant_members` upsert keyed on the Shell-provided slug so SKS managers land as `manager`.
2. **eq-service** — drop/guard the JWT branch in `app/(app)/layout.tsx` so role/tenant come from the
   real session, not claims.
3. **eq-shell** — add `https://urjhmkhbgaxrofurpbgc.supabase.co` (+ `wss://`) to the CSP
   `connect-src` for the embedded Service app.
4. **Verify**: through the Shell — settings page shows SKS branding, logo upload succeeds, role reads
   `manager`. Direct login unchanged. Re-check the MFA/AAL path (regression-prone — see CLAUDE.md).

Spans **2 repos** (eq-service + eq-shell). No data migration.

## Road B — finish the canonical migration (end-state, later)

Move Service's data + auth into canonical so the JWT identity *is* the right one and there's a single
backend. This is the larger multi-repo effort tracked in
[[project_eq_service_canonical_full_migration]]. Don't reach for this to unblock day-to-day work.

## What is NOT broken

- SKS branding is stored and live: `tenant_settings.logo_url` (SKS coloured) +
  `logo_url_on_dark` (SKS white) both point at real files; reports read this server-side via the
  admin client, independent of any user session.
- Company name set to "SKS Technologies" on 2026-06-14.

## Related

- `docs/runbooks/shell-service-domain-cutover.md`
- `lib/auth/service-jwt.ts`, `lib/supabase/server.ts` (`createJwtClient`)
