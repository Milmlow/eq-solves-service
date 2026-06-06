# Secrets — rotation runbook + scoped-key design

**Created 2026-06-07.** Covers Phase 0 (rotate what's exposed + native hardening) and Phase 1 (shrink the blast radius with scoped keys). Phases 2–3 (eliminate static secrets / adopt a manager) are noted at the end but not actioned.

**Rule:** this document contains **no secret values** — only names, locations, and steps. Never paste a real key in here.

---

## 0. Full secret inventory (where every credential lives)

| Secret | Stored in | Used by | Blast radius if leaked |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify, `.env.local`, GitHub Actions | Server actions (runtime); `backup.yml` storage backup | **Total** — bypasses all RLS, full read/write every tenant |
| `SUPABASE_DB_URL` | GitHub Actions | `backup.yml` (pg_dump) | **Total** — direct Postgres incl. password |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions | `backup.yml`, `data-quality.yml` | **High** — Supabase management API (create/delete projects, read keys). ⚠️ `data-quality.yml` exposes it on the `pull_request` trigger — see §0.5 |
| `SUPABASE_JWT_SECRET` | Netlify | JWT verification | **Total + disruptive** — rotating invalidates anon+service_role+**all user sessions** |
| `CRON_SECRET` | Netlify | Cron route bearer auth + scheduler | Medium — lets a caller trigger cron jobs |
| `RESEND_API_KEY` | Netlify, `.env.local` | Email send | Medium — send mail as you; quota abuse |
| `EQ_SECRET_SALT` | Netlify (+ Shell + Field — shared) | HMAC key for Shell↔Service↔Field cookie/payload signing | Medium — leak lets an attacker forge bridge cookies. Rotation is **coordinated 3-app** work (see §0.3) |
| `UNSUBSCRIBE_SECRET` | Netlify | Signs unsubscribe links | Low — rotating breaks links in already-sent emails |
| `EQ_SHELL_BRIDGE_SECRET` | `.env.local` only (**not** in Netlify) | Shell→Service bridge | Low today — bridge route 404s in prod (secret unset there) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` / `R2_BUCKET_NAME` | GitHub Actions | `backup.yml` upload to Cloudflare R2 | Medium — read/write the backup bucket |
| `EQ_TOKENS_PAT` | GitHub Actions | `check.yml`, `ci.yml`, `integration.yml` private package installs | Medium — GitHub token; scope depends on how it was minted |
| `EQ_PLATFORM_ADMIN_KEY` | **nowhere** (generated 2026-06-07, shown in chat) | `/api/tenants` provisioning (dormant) | Low — unused; regenerate at deploy time |
| `NEXT_PUBLIC_*`, anon key, `SUPABASE_PROJECT_REF` | Netlify | Client/build | **None** — public by design, never rotate for exposure |

---

## Phase 0 — Rotate what's exposed + native hardening

### 0.1 What was actually exposed in the 2026-06-07 session (honest scope)

Running `netlify env:list --json` wrote **every Netlify env value in plaintext into the session transcript** on disk (`C:\Users\EQ\.claude\projects\…\*.jsonl`). The GitHub Actions secrets were **only listed by name** — their values were *not* dumped.

- **Values now in the transcript (Netlify set):** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `EQ_SECRET_SALT`, `UNSUBSCRIBE_SECRET`. (Public values too — they don't matter.)
- **Shown in chat:** `EQ_PLATFORM_ADMIN_KEY` (unused).
- **NOT exposed (names only):** everything in GitHub Actions — `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `R2_*`, `EQ_TOKENS_PAT`.

**Threat-model calibration:** the transcript sits on the *same laptop* that already holds `.env.local`. So the marginal real-world risk is **low** — it's the same trust boundary, not a new public exposure. That means: **do not panic-rotate high-blast-radius keys right before go-live.** Rotate the cheap, isolated ones now; schedule the disruptive ones for after go-live (ideally folded into Phase 1).

**Lesson for next time:** never run `env:list`-style dumps in an agent session. To check *which* keys exist without printing values: `netlify env:list --plain | cut -d= -f1` (names only), or read `.env.example`.

### 0.2 Rotate now — low blast radius, do before go-live

These are safe to rotate immediately; nothing user-facing breaks.

**`RESEND_API_KEY`** — isolated, instant.
1. Resend dashboard → API Keys → **Create** new key.
2. Netlify (Service) → env → update value → mark **secret**.
3. Update `.env.local` locally.
4. Resend → **delete** old key.
5. Verify: send a test brief (`/maintenance/[id]` → Send brief) → email arrives.

**`CRON_SECRET`** — single consumer (Netlify only).
1. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Netlify (Service) → update `CRON_SECRET` → mark **secret** → redeploy.
3. Verify: `curl -s -X POST https://service.eq.solutions/api/cron/pre-visit-brief -H "Authorization: Bearer <new>"` → `{ ok: true, mode: "dry_run" }`. A 401 means the scheduler env didn't pick up the new value yet.

**`UNSUBSCRIBE_SECRET`** — low risk; only caveat is unsubscribe links in *already-sent* emails stop working. Acceptable. Rotate same as CRON_SECRET (Netlify only).

### 0.3 Schedule for AFTER go-live — high blast radius, do NOT rush

**`SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_JWT_SECRET`** — the disruptive pair.
- ⚠️ On legacy-key projects, the only way to rotate the service_role key is to **roll the JWT secret**, which invalidates the anon key, the service_role key, **and logs out every signed-in user**. Doing that the week of SKS go-live is self-sabotage for a low-real-risk exposure.
- **Correct move:** fold this into **Phase 1** — migrate to Supabase's new API-key system (`sb_secret_…`), which lets you create and revoke secret keys independently with **no session wipe**. Rotate *through* the migration, once, cleanly.
- Until then: the service-role key's only extra copy is on your own laptop's transcript — same trust boundary it already lived on.

**`EQ_SECRET_SALT`** — ⚠️ **NOT an isolated rotation — coordinated cross-app.** Verified 2026-06-07: this is an **HMAC key** (not a stored salt), used by `app/api/shell-auth/route.ts`, `proxy.ts`, and `app/(app)/admin/integrations/`. It must be **byte-identical across EQ Shell + EQ Field + EQ Service** — `shell-service-domain-cutover.md` calls a matching salt "the #1 go/no-go." Rotating it on Service alone **breaks the Shell→Service bridge and the Field integration**. So this is a *simultaneous three-app rotation* (Shell + Field + Service all flipped together), coordinated like the domain cutover — never a quick single-app rotate. Defer until you're doing coordinated Shell/Field/Service work anyway. It does **not** back any stored hash, so there's no data-orphaning risk — the risk is purely the shared-secret mismatch.

### 0.4 GitHub Actions secrets — not exposed, rotate on normal cadence

Values were never dumped, so **no urgency**. Rotate opportunistically:
- `SUPABASE_DB_URL`: Supabase → Settings → Database → **Reset database password** → rebuild the connection string → update the GH Actions secret. (This also rotates the password embedded in the URL.)
- `SUPABASE_ACCESS_TOKEN`: Supabase account → Access Tokens → revoke + create → update GH Actions.
- `R2_*`: Cloudflare → R2 → Manage API tokens → create new **scoped** token (see Phase 1) → update GH Actions → delete old.
- `EQ_TOKENS_PAT`: GitHub → Developer settings → fine-grained PAT → regenerate with **least scope** (read-only `contents` on the `@eq-solutions` package repos) → update GH Actions.

### 0.5 Native hardening (free, no rotation needed)

1. **Mark all Netlify secrets "secret"** — at minimum `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `EQ_SECRET_SALT`, `UNSUBSCRIBE_SECRET`. This stops `env:list` from printing them and masks them in the UI.
2. **Drop `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`** — ⚠️ only if you genuinely never exercise admin paths locally. Verified 2026-06-07: `serverEnv()` in `lib/env.ts` is a **lazy singleton**, so `npm run dev` *boots* without the key — but it throws the moment any admin-path server action runs (`createAdminClient()`), and it's required by the **integration tests** (`tests/integration/**`) and several **scripts** (`audit-rls`, `bootstrap-battle-test-users`, `seed-demo-attachments`, `tools/maximo-acb-import`). In practice most local testing needs it, so this "one fewer copy" win usually isn't worth the breakage. Keep it unless you do read-path-only UI work locally.
3. **Protect the privileged workflows with a GitHub Environment.**
   - ✅ **`backup.yml` — done in-file (2026-06-07):** both jobs now reference `environment: production-ops`. This holds the crown jewels (DB URL, service-role, R2). **You must finish it in the UI:** GitHub → repo Settings → Environments → **create `production-ops`** → add a **deployment-branch rule = `main` only**. A branch rule (not "required reviewers") is the right choice here because the job runs on schedule/dispatch from main, so it adds protection with **zero disruption** and no approval clicks. Until the env exists, the line is inert (GitHub auto-creates a rule-less env on first run = no behaviour change).
   - ⚠️ **`data-quality.yml` — left unchanged on purpose.** It holds `SUPABASE_ACCESS_TOKEN` (high blast radius — full management API) **but runs on `pull_request`**, so a `main`-only branch rule would break legitimate PR audit runs, and "required reviewers" would gate every PR. The clean fix is a separate decision (e.g. don't expose the real token on the PR trigger, or use a read-only token there) — flagged for you, not auto-applied. See §1.3-adjacent note below.

---

## Phase 1 — Shrink the blast radius (scoped keys)

**Principle: reduce privilege before centralising.** A leaked *scoped* key exposes one resource; a leaked god-key exposes everything. This is a bigger security win than any vault.

### 1.1 Migrate to Supabase's new API-key system
Supabase now issues `sb_publishable_…` and `sb_secret_…` keys that replace the legacy anon/service_role JWTs. Benefits that matter here:
- **Multiple secret keys** — issue a distinct one per consumer.
- **Independent revoke/rotate** — kill one without touching the others **and without a session wipe** (unlike rolling the JWT secret).

> Verify the exact capabilities + per-key scoping in **Supabase Dashboard → Settings → API Keys** — the granularity has been expanding; the dashboard is the authority, not this doc.

**Issue one secret key per consumer instead of sharing the service_role key:**

| Consumer | Key to issue | Why separate |
|---|---|---|
| Runtime app (Netlify) | `sb_secret` — "service-runtime" | Server actions need broad access; but it's now a *named, individually revocable* key |
| Backup job (GitHub Actions) | `sb_secret` — "ci-backup", scoped to **Storage** if supported | Backup only touches Storage — it should not be able to read every table |
| Local dev (if needed) | `sb_secret` — "local-dev", or none | If you can dev on the anon key, issue nothing |

Net effect: a GitHub Actions leak exposes the backup path, not your entire database. Each key is revocable in isolation.

### 1.2 Scope the Cloudflare R2 token
The `R2_*` keys in CI currently allow whatever they were minted with. Reissue a token **scoped to the single backup bucket, object read+write only** (Cloudflare → R2 → Manage API tokens → bucket-scoped). A CI leak then can't reach any other R2 bucket.

### 1.3 Least-scope the GitHub PAT
`EQ_TOKENS_PAT` should be a **fine-grained** PAT, read-only `contents`, limited to the specific `@eq-solutions` package repos — not a classic all-repo token.

---

## Phases 2–3 (noted, not actioned)

- **Phase 2 — eliminate static secrets.** Cloudflare R2 supports short-lived scoped tokens; prefer those in CI. Honest limit: **Supabase doesn't support GitHub OIDC**, so the DB URL / management token stay static — that irreducible set is the only thing a secrets manager is actually for.
- **Phase 3 — secrets manager.** Adopt only when a *second human* touches infra or manual rotation becomes the bottleneck. Doppler is a fine choice at that point; you'll be centralising a small, scoped, irreducible set rather than papering over sprawl.

---

## Verification checklist

- [ ] `RESEND_API_KEY` rotated + test brief email arrives
- [ ] `CRON_SECRET` rotated + dry-run curl returns `{ ok:true, mode:"dry_run" }`
- [ ] `UNSUBSCRIBE_SECRET` rotated (accept old links break)
- [ ] All Netlify secrets flagged "secret"; `netlify env:list --plain` no longer shows values
- [ ] `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`: keep (needed by integration tests + scripts) unless you do read-path-only local work — verified lazy-loaded, so don't bother dropping for boot reasons
- [x] `backup.yml` jobs reference `environment: production-ops` (applied in-file 2026-06-07)
- [ ] **UI step:** create the `production-ops` environment in GitHub + set deployment-branch rule = `main` only
- [ ] `data-quality.yml` PR-trigger token exposure decided (separate fix — not auto-applied)
- [x] `EQ_SECRET_SALT` usage checked — it's a **shared HMAC key across Shell/Field/Service**; rotation is coordinated 3-app work, not a quick rotate (see §0.3)
- [ ] **Post-go-live:** Supabase new-key migration done; service_role / JWT rotated through it with no session wipe
- [ ] **Post-go-live:** R2 token + GitHub PAT reissued least-scope
- [ ] `npm run check` green; one full backup workflow run succeeds end-to-end after rotations
