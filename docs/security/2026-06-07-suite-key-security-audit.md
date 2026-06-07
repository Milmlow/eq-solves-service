# Suite-wide key/security audit — 2026-06-07

Read-only audit of every EQ + SKS repo on disk for critical key/security items: hardcoded secrets, committed `.env`, secrets in logs, server-secret-on-client, RLS gaps, unguarded mutations/endpoints, committed build artefacts, headers/CORS, `.env.example` hygiene.

**Method:** parallel per-repo agents (read-only), then load-bearing findings spot-checked against the actual code / live advisors. Worktrees (`*-wt`) skipped (owned by other agents; duplicate their parent).

**Headline:** the suite is in **good shape**. No committed private secrets anywhere. The go-live app (eq-service) is clean. **One genuinely serious item:** an unauthenticated OCR endpoint in eq-shell. Everything else is low/medium or already-accepted architecture.

**Constraint on fixes:** this audit ran from the eq-service repo. Per workspace rules I can only *edit* eq-service from here; all other repos are reported with repo+path so they can be opened and fixed properly. Auth-flow changes and key rotations are flagged for Royce (need approval / his logins).

---

## The one to act on

### 🔴 HIGH — eq-shell: unauthenticated OCR endpoint
- **File:** `eq-shell/netlify/functions/ocr-parse.ts` (verified 2026-06-07).
- **What:** POST endpoint that takes a base64 image and runs Google Document AI using the privileged `google_doc_ai_credentials` service account. **No auth of any kind** — no JWT, no session cookie, no API key. Unlike every other shell function (which verify a session or a signed token first).
- **Real risk:** anyone with the URL can (a) **run up your Google Document AI bill** and (b) **use your paid service account as a free OCR service**. It does *not* leak your database — it only OCRs the caller's own uploaded image. So: billing/abuse, not customer-data exfiltration.
- **Also:** OPTIONS preflight returns `Access-Control-Allow-Origin: *` (line 60). Secondary — CORS only constrains browsers; a scripted caller ignores it. The missing auth is the real issue.
- **Open question before fixing:** is `ocr-parse` still used, and from where? eq-cards already has its **own** authenticated OCR function (`ocr-licence` — JWT + 20/hr rate limit). If Cards uses that, shell's `ocr-parse` may be an orphan → the fix could be "remove it" rather than "gate it." If it's called from the **public onboarding** form (pre-login), a plain JWT gate would break the flow — it'd need a short-lived signed token + rate-limit/Turnstile instead.
- **Fix class:** NEEDS-APPROVAL (auth-flow change) + must be done in the eq-shell repo (not from here). **Recommended next action.**

---

## Per-repo results

### eq-solves-service (go-live app) — CLEAN ✅
- No hardcoded secrets, no tracked `.env`, no secrets in logs, service-role never reaches client, every server action/API route guarded (`requireUser`/`getApiUser`/platform-key/CRON gate; platform-admin uses constant-time HMAC), all tables have RLS (zero ERROR advisors), strong headers, no `Access-Control-Allow-Origin: *`.
- **LOW** — `public/_headers`: CSP still `Content-Security-Policy-Report-Only` (HSTS + frame-ancestors already enforced separately). *Action:* check Netlify logs for `csp-report` entries, then flip to enforce (governed change — 24h report-only rule). **YOUR-ACTION.**
- **INFO** — live DB `public.tenant_slug_tombstones`: RLS on, no policy = deny-by-default (safe). Optional linter-silencing only; not worth a migration pre-go-live.
- **Nothing to fix in code.** Did not manufacture churn in the go-live repo.

### eq-shell — solid core, one HIGH (above)
- Auth bridge is well-built: constant-time HMAC (`timingSafeEqual`), separate bridge secret, HttpOnly+Secure+SameSite=Lax cookies scoped to `.eq.solutions`, AES-256-GCM for tenant keys, strong CSP/HSTS, all mint/admin endpoints session-guarded + `is_platform_admin` on privileged ones. No tracked `.env`, no service-role on client, no secrets in logs.
- 🔴 **HIGH** — `ocr-parse.ts` unauthenticated (see above).
- **LOW** — `scripts/provision-sks-tenant.mjs:29`: hardcoded **anon** JWT literal (public by design; poor hygiene, trips scanners). Move to env. **YOUR-ACTION (optional).**

### eq-solves-field — no leaks; permissive RLS is accepted architecture
- No private secrets, no tracked `.env`/artefacts. All 5 Netlify + 3 edge functions auth-gated (HMAC, constant-time, server-only secrets; tenant derived from signed token → no IDOR). Embedded JWTs are anon/publishable.
- **MED** — `migrations/2026-06-02_demo_app_config_codes.sql:45-53`: plaintext access PINs committed, but only for the **demo/sales-showcase** tenants (eq front-door, demo-trades, melbourne) — not real customers, and already public in the old client map. *Action:* rotate via Supabase if any of those ever holds real data; stop putting codes in migrations (seed by hand). **YOUR-ACTION.**
- **LOW/INFO** — ~55 `USING (true)` policies on business tables: root cause is the shared-anon-key + shared-PIN model (no `auth.uid()`), so RLS can only enforce `org_id IS NOT NULL`. Documented + accepted; June-3 migrations already moving tables onto a secured `app_data.*` JWT model. **NEEDS-APPROVAL (the planned per-user-auth workstream — don't patch piecemeal).**

### sks-nsw-labour — no leaks; RLS permissive by design
- No private secrets, no tracked `.env`/artefacts, strong headers/CORS allowlist. Functions auth-gated (HMAC session token / Bearer / single-use signed magic-link with self-approve + CAS-idempotency checks). Embedded JWTs are anon.
- **MED** — RLS by design: anon key is in client JS, several tables `USING (true)` / writes gated only by `org_id IS NOT NULL`. Tenant isolation relies on app/function layer, not the DB. Deliberate (no Supabase Auth). **NEEDS-APPROVAL (architectural).**
- **LOW** — `netlify/functions/eq-agent.js:56` + `send-email.js:60`: token compare uses `!==` (string) while sibling functions use `timingSafeEqual`. Minor timing-oracle inconsistency. **SAFE-CODE-FIX** (in the SKS repo).
- **LOW** — `verify-pin.js` / `eq-agent.js`: rate-limit/lockout is per-cold-start in-memory → weaker than it looks across instances. **SAFE-CODE-FIX (optional hardening).**

### eq-cards — clean
- All 8 tables have RLS, anon RPC grants correctly `REVOKE`d, CORS fail-closed allowlist. Flutter client uses anon key via `--dart-define`; no service-role in client.
- **LOW** — `supabase/migrations/0010_admin_onboarding.sql:291-296`: stale/misleading comment (code is correctly locked down). **SAFE-CODE-FIX (comment only).**
- **INFO** — `supabase/functions/share-licence/index.ts`: unauthenticated GET returns licence_number + holder_name, gated only by an unguessable UUID (QR-verification design). Confirm that's the intended trust model. **YOUR-ACTION (confirm).**

### eq-intake — clean
- Shared parse API authenticates every caller (Bearer JWT via `getUser()`), rate-limits per tenant (50/60min), 10k-row cap, allow-listed entities, tenant can't be overridden via body → no IDOR. Service-role server-side only.
- **LOW** — `edge-functions/api-intake/index.ts:93-97`: `Access-Control-Allow-Origin: *` (acceptable — Bearer auth, not cookies). **YOUR-ACTION (accept).**
- **LOW** — same file ~190: rate-limit RPC **fails open** on error (deliberate). Note for an abuse-sensitive surface. **YOUR-ACTION (accept).**

### eq-quotes (`eq-quotes-port`, Flask) — clean code; live `.env` on disk
- Every route gated, security headers strong (HSTS, CSP), no hardcoded secrets (`os.environ.get` throughout).
- **MED** — `eq-quotes-port/.env` holds a live `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`) + Voyage + canonical + Flask keys. **Correctly gitignored and NOT tracked** — risk is local/accidental `git add -f`. *Action:* keep gitignored; rotate only if the machine/file was ever shared. **YOUR-ACTION.**
- **LOW** — `app/webhooks/routes.py:33-35`: `_verify_svix()` returns `True` (skips signature check) when `RESEND_WEBHOOK_SECRET` is unset → `/webhooks/resend` accepts unsigned payloads if the env var is missing. **SAFE-CODE-FIX (fail closed) / YOUR-ACTION (ensure secret set).**
- **LOW** — `QUOTES_SKIP_PASSWORD=1` disables the shared-password gate (pilot flag). Confirm intended for live. **NEEDS-APPROVAL.**

### Lower-risk repos — CLEAN
- eq-roles, eq-ui, eq-design-tokens, eq-context, eq-solves-assets: no committed private secrets, no tracked `.env`, no committed build artefacts.
- **LOW** — `eq-solves-assets/public/config.js`: anon key in source (public by design; could move to build env). **YOUR-ACTION (optional).**
- eq-analytics-v2, eq-website, akko-jobsetup, md-health-reports, sks, _eqwire, supabase: not git repos / no tracked secrets. `_eqwire` SQL references the `service_role` *schema role* (not a key).

---

## Action lists

### Royce-action (rotations / dashboard / confirmations — need your logins)
1. **(after deciding ocr-parse fix)** nothing to rotate unless that endpoint was abused — check Google Cloud billing for unexpected Document AI usage.
2. eq-field demo PINs — rotate in Supabase *only if* a demo tenant ever holds real data; stop committing codes.
3. eq-quotes `.env` — keep gitignored; rotate the service-role key only if that file/machine was ever shared.
4. eq-service CSP — check Netlify `csp-report` logs, then flip report-only → enforce.
5. Confirm intended trust models: eq-cards `share-licence` (name+licence by UUID), eq-quotes `QUOTES_SKIP_PASSWORD`.

### Needs approval (auth-flow — chat sign-off before code)
1. **eq-shell `ocr-parse` auth gate** (or removal) — the HIGH item.
2. eq-field / sks-nsw-labour per-user-auth cutover — already a planned workstream; don't patch piecemeal.

### Safe code fixes (small, in their own repos — not eq-service)
1. sks-nsw-labour: swap `!==` token compares to `timingSafeEqual` (`eq-agent.js`, `send-email.js`).
2. eq-quotes: `_verify_svix` fail-closed in prod.
3. eq-cards: fix stale comment in `0010_admin_onboarding.sql`.
4. (optional) sks rate-limit → shared store; eq-solves-assets anon key → env.

### eq-service (this repo) — nothing required
The go-live app is clean. No code fixes applied (deliberately — no churn in the go-live repo). The CSP flip is the only item and it's a governed YOUR-ACTION.
