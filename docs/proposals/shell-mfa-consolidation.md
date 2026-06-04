# Proposal — Consolidate MFA at the Shell identity layer

**Status:** DRAFT for approval · **Author:** Royce (via Claude) · **2026-06-04**
**Primary repo:** `eq-shell` (cross-repo: also `eq-solves-service`, later `eq-solves-field`, `eq-quotes`)
**Blast radius:** auth — requires explicit sign-off before any code. No code written yet.

## Problem

Each EQ app is moving to trust Shell for authentication (Service's `eq_shell_bridge`
bypass, Field's cookie handoff, Cards). But Shell's session does not tell a
downstream app *how strongly* the user authenticated, so each app must choose
between two bad options:

- **Blanket-trust** any Shell session (what Service does today) — which silently
  accepts single-factor PIN users into surfaces that previously required TOTP, and
- **Re-challenge** its own MFA inside the iframe — which reintroduces the double
  prompt we just removed, and duplicates MFA across every app in the suite.

Neither scales as the suite grows. MFA should live **once**, at the identity layer.

## Verified current state (2026-06-04)

- **Shell primary factor:** alphanumeric PIN, 4–12 chars, bcrypt cost 12, rate-limited
  5 attempts / 15 min per IP (`netlify/functions/shell-login.ts`).
- **Shell TOTP:** RFC 6238, 6-digit, enrolled per-user — **optional**. Only challenged
  when `users.totp_enrolled_at` is set. PIN alone completes login otherwise.
- **`eq_shell_session` payload** (`netlify/functions/_shared/token.ts`): identity +
  role only — `user_id, tenant_id, active_tenant_id, role, is_platform_admin,
  memberships, email, name, extra_perms, config, exp`. **No `aal` / `mfa` / `amr` field.**
- **Service** (`proxy.ts`) bypasses its own TOTP whenever `eq_shell_bridge=1` is set —
  i.e. for *any* Shell-originated session, regardless of whether TOTP was satisfied.

Net: a PIN-only Shell user is trusted by Service as if MFA-complete.

## Proposed design

### 1. Make TOTP enforceable by policy (Shell)
Add a tenant/role-level policy flag (e.g. `tenant_settings.require_totp`, or per-role)
so TOTP can be **mandatory** for the tenants/roles that need it, instead of purely
opt-in. Enrolment UX already exists (`enroll-totp` / `confirm-totp`); this gates login
completion on it where required. Keep a grace window for first-time enrolment (mirror
Service's existing 14-day MFA grace so onboarding isn't blocked day one).

### 2. Carry an auth-assurance claim in the session (Shell)
Extend `SessionPayload` with an explicit, signed assurance field:

```
aal: 'aal1' | 'aal2'      // aal2 = a second factor (TOTP) was satisfied this session
amr?: ('pin' | 'totp')[]  // optional: methods actually used, for audit/clarity
```

Set `aal: 'aal2'` only after a successful TOTP challenge; `aal1` for PIN-only. The
field is inside the HMAC-signed payload, so downstream apps can trust it without a
round-trip. Bump a payload `v` so old cookies (no `aal`) are treated as `aal1`.

### 3. Apps trust the claim, not the entry path (Service first)
Service stops keying the MFA bypass on the coarse `eq_shell_bridge` flag and instead:

- Reads `aal` from the verified `eq_shell_session` in `proxy.ts`.
- Bypasses its own TOTP **only when `aal === 'aal2'`** (and policy for that tenant/role
  doesn't demand step-up beyond Shell).
- Keeps its existing `/auth/mfa` TOTP path for **direct, non-Shell logins** (break-glass
  / admin) — unchanged.

Field, Quotes, etc. adopt the same read when they wire up.

## Rollout

1. Shell: add `aal`/`amr` to the payload, default `aal1`, ship. No behaviour change
   (Service still bypasses on `eq_shell_bridge`). Pure additive.
2. Shell: turn on `require_totp` for a pilot tenant (SKS) with a grace window; confirm
   enrolment + challenge work end-to-end.
3. Service: switch the bypass condition from `eq_shell_bridge` to `aal === 'aal2'`,
   behind a flag, verify, then make default.
4. Field / others adopt the same claim read.

**Rollback** at each step is independent: Service can revert to the `eq_shell_bridge`
condition; Shell can default `require_totp` off.

## Security notes / open questions

- **`EQ_SECRET_SALT` strength** — the cookie HMAC currently uses a demo-grade,
  Field-shared salt (`eq-field-demo-…`). Since this signature is what vouches for the
  `aal` claim, it should be rotated to a strong random secret as part of this work —
  **coordinated across Shell + Field + Service simultaneously** or SSO breaks. Track
  separately; do not piecemeal.
- **Step-up auth** — do any Service surfaces (e.g. admin, deactivating users) warrant
  forcing `aal2` even for Shell users whose tenant doesn't mandate TOTP? Decide per
  surface; the claim makes it possible.
- **Direct access to `service.eq.solutions`** — long-term, should human login at the
  app subdomain be disabled entirely (Shell is the only front door), leaving app-level
  signin for break-glass only? Out of scope here; flag for the platform decision.

## Decision needed from Royce

- [ ] Approve the direction (MFA consolidates at Shell; apps trust an `aal` claim).
- [ ] Confirm which tenants/roles should have `require_totp` on at go-live (SKS techs?).
- [ ] Approve scheduling the `EQ_SECRET_SALT` rotation as coupled Shell+Field+Service work.
