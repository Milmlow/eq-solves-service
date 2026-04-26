# 30-Day Plan — Surfaced 2026-04-26

Consolidated punch list of everything flagged during the 2026-04-26 review and reports-redesign session. Each item has: a one-line description, why it matters, rough effort, and a recommended priority bucket.

This is a reference document — it doesn't enforce anything. Use it as the input when you decide what to work on next, and update/cross off as items land.

---

## Priority A — ship within ~7 days

These are the items where the cost of *not* doing them is real (hidden bug, ongoing brand damage, or operational risk).

### A1. Pre-push build gate (~30 min)

Tonight added `npm run check` (`tsc --noEmit && next build`) as an opt-in script. Two prod build failures in this evening's session would have been caught by it.

**Next step:** add a GitHub Action that runs `npm run check` on every push to `main` and blocks the Netlify deploy hook if it fails. ~40 lines of YAML, removes the entire class of "I forgot to run build locally."

### A2. Reports design audit fixes — Phase 1 (~2 hr)

Documented in [docs/audits/2026-04-26-reports-design-audit.md](docs/audits/2026-04-26-reports-design-audit.md). Phase 1 = items S1, S3, N1, N2 from the audit:
- Centralise colours + borders into `lib/reports/colours.ts`
- Centralise font into `lib/reports/typography.ts` (Aptos Display + Aptos per Brief v1.3)
- Replace hex literals across all generators

Brand consistency wins immediately. Doesn't touch any data flow, low risk.

### A3. SKS `report_company_abn` is null

Migration 0015 added the column, but it was never populated for SKS. Current report covers read "Confidential — SKS Technologies" with no ABN suffix. Set via `/admin/reports`. ~2 min if you have the ABN handy.

### A4. eq-context merge conflicts

Markdown sweep flagged unresolved `<<<<<<<` / `=======` / `>>>>>>>` blocks in `C:\Projects\eq-context\state\products.md` and `state\pending.md`. These files load into every Claude session as project context — they've been silently broken for who knows how long. Resolve manually. ~5 min.

### A5. Supabase backup restore drill (~30 min)

You confirmed backups are on but nobody has tested a restore. "Backups exist" ≠ "we can restore." One-time drill: create a Supabase branch project, restore yesterday's snapshot into it, click through the app pointing at the branch, confirm it loads. After that you have an honest answer to "what's our recovery time."

---

## Priority B — within 30 days

Real issues but not on fire today.

### B1. Auth hardening pass (~2 hr, requires explicit Royce approval before push)

Three independent items:

**B1a. `requireUser()` non-determinism.** [lib/actions/auth.ts:15-21](lib/actions/auth.ts:15) — `.limit(1).maybeSingle()` with no `ORDER BY` means a user in multiple tenants gets a coin-flip tenant per session. Doesn't matter today (only Royce is in multiple) but bites the moment a non-you human is in multiple tenants. Fix: `.order('created_at', { ascending: true })` + ideally a `last_active_tenant_id` column on profiles for an explicit tenant switcher.

**B1b. `'use server'` directive on helper files.** [lib/actions/auth.ts:1](lib/actions/auth.ts:1) and [lib/actions/idempotency.ts:1](lib/actions/idempotency.ts:1) both have `'use server'`. These files contain helpers, not action endpoints — every export becomes a public RPC by accident. Today blocked by accidental-serialisation-error in `requireUser`'s return value, but one refactor away from being a working "tell me my own auth state" public endpoint. Fix: delete the directive from both files.

**B1c. MFA regression test.** Royce confirmed the AAL1 loop was fixed 2026-04-26. No automated check confirms it stays fixed. Quick test: a Playwright script that creates a user → enrols TOTP → signs out → signs in → asserts the MFA challenge resolves cleanly. Run on every push.

### B2. Cross-tenant isolation smoke test (~1 hr)

Single Node script: `scripts/check-isolation.ts`. Logs in as a fixture user in tenant SKS, asserts every `SELECT *` returns only SKS rows, asserts an UPDATE on a Demo-owned row fails. Run via `npm run check` on every push. Catches the entire "RLS policy regression" class of bug that no other check catches.

### B3. Reports design audit fixes — Phase 2 (~3 hr)

Items S2, S4, Q1–Q4 from [the audit](docs/audits/2026-04-26-reports-design-audit.md). Bigger surface area, requires per-report eyeball comparison before/after. Don't push without you reviewing the rendered output.

### B4. Idempotency adoption gaps (~1 hr each module)

`withIdempotency()` is used in maintenance + reports. Not used in:
- `app/(app)/testing/acb/actions.ts` (ACB tests on flaky-network jobsites — exact use case)
- `app/(app)/testing/nsx/actions.ts`
- `app/(app)/contacts/actions.ts` (CSV import retry)
- `app/(app)/admin/users/actions.ts`

Each is an opportunity for a duplicate write under retry. Fix incrementally — wrap one action per session, audit-log the same `mutationId` inside the wrapper.

### B5. Defects schema doc cleanup

CLAUDE.md says "soft delete via `is_active` everywhere." `defects` doesn't have `is_active` — it uses `status` (open/resolved). Tonight fixed the legacy `generate-and-store.ts` queries that hit this. CLAUDE.md should be updated to call out the exception explicitly so future Claude doesn't write the same bug a third time.

### B6. Dashboard `as any` / `as unknown as` casts (~1 hr)

[app/(app)/dashboard/page.tsx:167](app/(app)/dashboard/page.tsx:167) and `:247-250` have `as unknown as { name: string }` and `as any` patterns to paper over Supabase's `T | T[]` join cardinality unions. Fix: add a `lib/db/relation.ts` helper that takes `T | T[] | null` and returns `T | null`, replace casts. Also re-run `supabase gen types typescript` so the types are current — they're stale.

---

## Priority C — within 90 days

Improvements that compound but aren't urgent.

### C1. Per-asset technician sign-off in HTML→PDF template

If you ever revisit PDF reports, the legacy DOCX generator includes a "I confirm that the above work has been carried out... Name: <tech> Date: <date>" line at the bottom of every asset's detail section. The new HTML template doesn't have this. Important for compliance documentation.

### C2. Outstanding work-orders count on cover

Legacy DOCX cover shows "Outstanding Work Orders: 4." New HTML template doesn't. Add to template + loader if PDF revives.

### C3. Migration count discipline

Markdown files keep claiming "0001-0025" / "0001-0045+" / "0001-0065+" — these claims rot in days. Replace all numeric migration counts with "see `supabase/migrations/`" so they don't need maintenance.

### C4. Audit-log enforcement (~30 min once decided)

Some server actions write audit logs, some don't. No middleware enforces it. Options: (a) lint rule that flags any `'use server'` action whose body doesn't call `logAuditEvent`, (b) wrap mutations in a middleware that logs automatically. (a) is simpler.

### C5. Tenant-aware Gotenberg / Browserless decision

If reports become a differentiator: revisit the PDF backend choice. Browserless ~$30/mo, Performance-1x Fly ~$25/mo. Tonight's debug session ate 90 minutes — worth the spend if PDF reports happen.

---

## Done tonight 2026-04-26

For the record:

- ✅ Build fix (`showOverview` dangling reference)
- ✅ Markdown sweep — refreshed CLAUDE.md, README.md, ARCHITECTURE.md, LOCAL_DEV.md
- ✅ HTML→PDF Phase 1 scaffolding (renderer wrapper, data loader, HTML template, API route) — code shipped, deferred behind DOCX-only choice
- ✅ Defects `is_active` bug fix in legacy `generate-and-store.ts` (was an unfired landmine on the existing report path)
- ✅ `npm run check` script + documentation
- ✅ Reports design audit (this evening's biggest deliverable: [docs/audits/2026-04-26-reports-design-audit.md](docs/audits/2026-04-26-reports-design-audit.md))
- ✅ This 30-day plan
- ✅ Fly Gotenberg decommissioned tonight (Royce will run `fly apps destroy` tomorrow per overnight checklist)

## Maintenance discipline

This document is a snapshot. Tomorrow it's already drifting. Two rules to keep it useful:

1. **When you finish an item, cross it off and move it to a "Done 2026-XX" section at the bottom.** Don't delete — the history is useful.
2. **When you discover something new, append it to the right priority bucket.** Don't queue items in your head — they get lost.
