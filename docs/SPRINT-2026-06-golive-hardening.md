# Sprint — Security & Go-Live Hardening

**Target:** SKS go-live 2026-06-21. **Opened:** 2026-06-13.
**Theme:** make the merged security work actually live and verified, and close
the gaps a live audit of prod surfaced — before real SKS data and techs arrive.

Tenant project: `urjhmkhbgaxrofurpbgc`. Live read-only checks via Supabase MCP
(`get_advisors` + `rls_introspection()`); `npm run audit:rls` / `audit:actions`
as the repeatable gates.

---

## Phase 0 — DONE (2026-06-13)

- RLS tenant-isolation tests (3 layers) + `audit:rls` repaired + `audit:actions`
  CI gate. PRs #282, #283, #284 merged.
- Test-defect canonical sync fix (ACB + NSX → `syncDefect`). PR #283.
- **Applied to prod** (verified): `0126` rls_introspection fn, `0127`
  notifications insert-policy drop (was already absent), `0128` context_files
  anon-read drop (**live information-disclosure closed**), `0129` lock
  rls_introspection to service_role (fixed an anon-exposure the advisor caught).
- Live posture: 43 tenant tables, all RLS on, zero permissive policies, no
  ERROR advisors.

---

## Phase 1 — Site-credentials encryption rollout 🔴 HIGH (pre-go-live) [GATED]

**Why:** Live audit found `public.site_credentials` still stores **plaintext**
`password_value` / `username`, and the encryption RPCs (`decrypt_site_credential`,
`upsert_site_credential`) are **missing from prod** — so the deployed
`/api/site-credentials/[id]/decrypt` route (which calls the RPC) returns 500.
Migrations `0123` + `0124` are unapplied. SKS techs need site access info on
go-live, so this must be a clean, coordinated rollout — NOT a blind replay.

**Steps (in order, each verified before the next):**
1. Confirm `SITE_CREDENTIALS_KEY` is set in Netlify (both sites if the JWT/canonical
   path serves credentials). Do NOT print the value.
2. Audit the write path: `app/api/site-credentials/route.ts` + `[id]/route.ts` —
   confirm whether they already call `upsert_site_credential` (broken now) or
   insert plaintext directly. Determines current prod behaviour.
3. Apply `0123` (creates `app_data`, moves table, adds `_enc` columns + RPCs)
   then `0124` (grants — depends on `app_data` existing).
4. Run `scripts/rekey-site-credentials.ts` (service role + `SITE_CREDENTIALS_KEY`)
   to encrypt existing plaintext rows, then confirm `_plain` columns are NULL.
5. Fix role-name drift: `decrypt/route.ts` gates on `['super_admin','admin',
   'supervisor']` — post-C6 the role is `manager`, so managers may be wrongly
   forbidden. Align to canonical roles.
6. Smoke test: supervisor/manager can decrypt; write encrypts; advisor clean.

**Acceptance:** site_credentials in `app_data`, only `_enc` populated, decrypt
route returns plaintext for supervisor+, no plaintext at rest, advisor clean.

---

## Phase 2 — Canonical data completeness

1. **Run "Import from Canonical"** at `/admin/integrations` (needs
   `CANONICAL_API_KEY_SERVICE` — set). Brings ~380 customers, ~554 sites, ~4808
   assets. `assets.canonical_id` columns already exist on prod.
2. **Fix asset bulk-import sync gap:** `importAssetsAction` inserts without
   `syncAsset()`, so bulk-imported assets never reach canonical (single
   create/update do sync). Mirror the customer/site bulk pattern.
3. **Verify the sync loop:** confirm the nightly `canonical-pull` cron (22:00
   UTC) and the outbox drain (every 5 min) actually fire and aren't erroring
   (Netlify function logs); confirm write-through stamps `canonical_id`.

**Acceptance:** eq-service counts reconcile with canonical; assets visible;
crons green in Netlify logs.

---

## Phase 3 — Migration-history reconciliation (hygiene)

**Why:** prod's `schema_migrations` is unreliable — `0125`'s columns exist on
prod but aren't recorded; `0123`/`0124` are neither recorded nor applied. This
session recorded `0126`–`0129`. Out-of-band DDL has been happening.

1. Record `0125` (idempotent — columns already exist) so history is contiguous.
2. Resolve `0123`/`0124` via Phase 1.
3. Add a lightweight drift check (compare repo `supabase/migrations/` count vs
   `schema_migrations`) to the weekly audit runbook so this can't silently recur.

---

## Phase 4 — Go-live readiness (SKS 2026-06-21)

- MFA enrolled per tech; training-data sanity check; live-day support plan
  (see `docs/security/onboarding-day.md` / `sks-golive-final-steps.md`).
- Run `npm run audit:rls` (against prod) + `npm run audit:actions` as the
  pre-go-live security gate; zero ERROR findings is the bar.
- Re-verify MFA AAL flow (regression watch per CLAUDE.md).

**Acceptance:** every tech can sign in with MFA; both audits clean; a named
person owns live-day support.

---

## Risk gates (do not skip)

- **Phase 1 touches encrypted credentials** — never apply `0123` without
  `SITE_CREDENTIALS_KEY` confirmed and the rekey script ready. Plaintext loss or
  a broken decrypt path on go-live day is the worst-case.
- **Any prod RLS/policy change** — verify with `get_advisors` immediately after
  (this session caught a self-inflicted anon-exposure that way).
- **Migration history is not ground truth** — verify actual schema objects
  before applying or assuming.
