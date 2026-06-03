# Runbook — Shell↔Service domain cutover (kill the double login)

**Status:** ready to execute · **Owner:** Royce · **Last updated:** 2026-06-04

## Why

EQ Service is embedded as an iframe inside EQ Shell. Today Service is served at
`eq-solves-service.netlify.app` — a **different registrable domain** from Shell
(`core.eq.solutions`). That makes the iframe a *cross-site* (third-party) context,
so Service's session + `eq_shell_bridge` cookies must be `SameSite=None`. Safari
ITP and Chrome's third-party-cookie phase-out **block** those cookies, the session
doesn't persist, and the user is bounced to sign-in — the **double login**.

The fix is the same one Cards and Field already use: serve Service on a sibling
subdomain of Shell, **`service.eq.solutions`**, so the iframe is *same-site* and
cookies flow under `SameSite=Lax` (which browsers do not block).

## Code change (this PR — already host-gated, safe to merge anytime)

`lib/auth/shell-cookies.ts` decides the cookie policy from the **request host**:

- Host ends with `.eq.solutions` → `SameSite=Lax; Secure` (same-site iframe — Cards/Field pattern)
- Otherwise (`*.netlify.app`) → `SameSite=None; Secure` (legacy fallback during cutover)

Wired into every cookie-writing path: `proxy.ts` (fast-path + `eq_shell_bridge`),
`lib/supabase/{middleware,server,client}.ts`, `app/api/shell-auth/route.ts`.

Because it keys on host, **nothing changes until Service is actually served from
`service.eq.solutions`** — the same build is correct on both hosts while they run
in parallel. Test: `tests/lib/auth/shell-cookies.test.ts`.

## How the cookie SSO actually works after cutover

1. User is signed into Shell at `core.eq.solutions` → Shell sets `eq_shell_session`
   (`Domain=.eq.solutions`, `SameSite=Lax`, HMAC-signed with `EQ_SECRET_SALT`).
2. Shell loads the iframe at `https://service.eq.solutions` (cookie mode — no token).
3. Browser sends `eq_shell_session` to Service (same-site, Lax). ✅
4. Service `proxy.ts` fast-path HMAC-verifies it **with the same `EQ_SECRET_SALT`**,
   mints a magic-link OTP server-side, establishes the Supabase session, and sets
   `eq_shell_bridge=1` — now `SameSite=Lax`, so it persists. ✅
5. Subsequent iframe navigations carry the Lax cookies. No second login.
   `eq_shell_bridge` makes `proxy.ts` skip the MFA redirect (see "MFA" below).

## Pre-flight checklist (do BEFORE flipping Shell)

- [ ] **`EQ_SECRET_SALT` matches** — Service's value MUST be byte-identical to
      Shell's. If it differs, `verifyShellCookie()` returns null, the fast-path
      falls through, and the double login *persists* (looks like the fix failed).
      **This is the #1 go/no-go.** Compare the `EQ_SECRET_SALT` env var in the
      Netlify dashboards for `eq-solves-service` and the Shell site.
      *(Verified present on Service 2026-06-04; Shell-side comparison still TODO —
      CLI couldn't read Shell's env from the dev box.)*
- [ ] **Netlify custom domain** — `service.eq.solutions` is set as `custom_domain`
      on the `eq-solves-service` site *(confirmed 2026-06-04)*. Confirm DNS resolves
      and the TLS cert is provisioned: `curl -I https://service.eq.solutions`
      returns 200/3xx with a valid cert (run from a real network, not the dev sandbox).
- [ ] **`NEXT_PUBLIC_SITE_URL`** on Service → set to `https://service.eq.solutions`
      (currently `https://eq-solves-service.netlify.app`). Affects magic-link
      `redirectTo` and absolute URLs.
- [ ] **Supabase Auth → URL config** (project `urjhmkhbgaxrofurpbgc`) includes
      `https://service.eq.solutions` in Site URL / redirect allowlist, or the
      server-side OTP exchange is rejected. See `supabase-auth-configuration.md`.
- [ ] **CSP** — Shell's `frame-src` already allows `service.eq.solutions` (no change).
      Service's `public/_headers` `frame-ancestors` already allows `*.eq.solutions`.

## Cutover sequence (each step reversible)

1. **Merge this PR + deploy Service.** Inert on `netlify.app`; readies the new host.
2. **Stand up `service.eq.solutions`** end-to-end (domain + cert + `EQ_SECRET_SALT`
   + `NEXT_PUBLIC_SITE_URL` + Supabase URL). Service now serves on BOTH hosts:
   `netlify.app` stays token-mode (status quo), `service.eq.solutions` is cookie-mode-ready.
3. **Verify Service on the new host in isolation** — point a Shell *preview's*
   `VITE_SERVICE_URL=https://service.eq.solutions` and sign in. Watch for **zero**
   second-login in **both Safari and Chrome** (the two that block 3p cookies).
4. **Flip Shell prod:** set `VITE_SERVICE_URL=https://service.eq.solutions` in the
   Shell Netlify env and redeploy. Shell auto-switches to cookie mode.
5. **Soak a few days**, then a follow-up PR retires Service's now-dead token paths
   (`app/shell/`, `app/api/shell-auth/`, `app/(auth)/auth/shell-bridge/`).

**Rollback:** unset (or revert) `VITE_SERVICE_URL` on Shell → instantly back to
`netlify.app` token-mode. Nothing is one-way until step 5.

## MFA — current behaviour and the long-term call

**Current (keep for the SKS onboarding):** cookie mode sets `eq_shell_bridge`,
which makes `proxy.ts` skip Service's TOTP challenge — i.e. **trust Shell**. This
removes the double prompt and is right for field techs entering through Shell.

**The catch (verified 2026-06-04):** Shell's primary factor is an alphanumeric
**PIN** (bcrypt, rate-limited). Shell *supports* TOTP but it is **optional**
(only enforced if the user enrolled it), and the `eq_shell_session` cookie carries
**no `aal`/`mfa` claim**. So today Service blanket-trusts "came from Shell" and
cannot tell whether the user actually passed a second factor — a PIN-only Shell
user trusted by Service is *single-factor*, weaker than Service's own TOTP.

**Long-term target:** consolidate MFA at the identity layer (Shell), don't
duplicate it per app:
1. Make TOTP **mandatory** at Shell for the roles/tenants that require it
   (the mechanism already exists).
2. Add an explicit **`aal`/`mfa_satisfied` claim to `eq_shell_session`**.
3. Service (and Field, Quotes, …) bypass their own MFA **only when Shell asserts
   MFA was satisfied** — not for any Shell session. Each app keeps its own TOTP
   path for direct (non-Shell) logins as break-glass.

Until (1)–(3) land, treat the bypass as an accepted convenience, not the finished
security model.
