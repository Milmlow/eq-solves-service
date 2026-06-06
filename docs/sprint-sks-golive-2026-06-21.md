# Sprint — SKS tenant fully functional (go-live 2026-06-21)

**Written:** 2026-06-06 (T-15 days) · **Source of truth:** live DB `urjhmkhbgaxrofurpbgc` + `origin/main`, not docs.
This plan steelmans the existing docs (`30-day-plan.md`, `runbooks/onboarding-day.md`, `runbooks/sks-golive-tenant-seed.md`, `FEATURES.md`, the integration architecture set) and corrects them against ground truth verified this session.

---

## Definition of Done — "SKS fully functional"

A tech, on go-live morning, can:

1. **Sign in** (Shell SSO or direct), pass the MFA grace gate, and land in the SKS tenant seeing **only SKS data**.
2. **Find real work waiting** — scheduled PM checks exist against real assets (not an empty calendar).
3. **Run every workflow end-to-end** on real assets — PPM, ACB, NSX, RCD — producing a complete, propagated check.
4. **Raise a defect** from a failure and see it in the register.
5. **Generate a customer report + field run-sheet**, correctly SKS-branded, populated with real data.
6. Historical test data is **either linked into the workflow or explicitly archived** — no ambiguous floating state.
7. **No cross-tenant leakage**; a backup exists; rollback path is known.

---

## Ground truth (verified this session — supersedes the docs where they disagree)

| Area | Reality | Doc said | Verdict |
|---|---|---|---|
| Auth / SSO / provisioning | Shipped to main (PRs #225–#239, migrations 0113–0119) | "Phase 1 deferred" | **Done** — docs lag |
| Foundation data | 4,769 assets · 28 sites · 7 customers · 55 job plans · 667 plan items · 128 contract scopes | "load T-3 days" | **Done** — fully loaded |
| Members | 9 SKS members (6 manager / 2 supervisor / 1 employee), canonical roles | "invite each tech" | **Mostly done** |
| Branding + report ABN | `report_company_abn = 51 168 906 956`, name "SKS Technologies", logo + colour set | "A3: ABN is null — must fix" | **Stale** — already done |
| `nostalgic-bouman` branch | Superseded C6 variant; `0114` filename collision with shipped migration | "possible security gap to merge" | **Do not merge** |
| Operational throughput | `pm_calendar = 0`, `defects = 0`, 15 checks for 4,769 assets | — | **The real gap** |
| ACB/NSX test history | 453 ACB + 254 NSX tests, but only 7 ACB / 1 NSX linked to a check | — | **Floating — decision needed** |
| Orphaned user | `mark.brame@sks.com.au` (real SKS person) not attached to tenant | — | **Quick fix** |
| Advisors | 0 ERROR (security + performance) | — | **Clean** |

**Headline:** the hard blocker (auth/SSO/provisioning) is *done*, and the foundation is *production-grade*. What's missing is **operational throughput** — there is no scheduled work for techs to do, no defects, and 700+ historical tests sit disconnected from the check workflow. That's the sprint.

---

## P0 — must ship before 2026-06-21

> **Execution log (2026-06-06):** P0-0, P0-2, P0-3, P0-4 done. P0-1 demo seed done; real PM checks pending a week-1 scope call. P0-5 pending (interactive).

### P0-0 · 🔴 Auto-defect crash — FIXED (found + fixed this session)
**Found 2026-06-06.** All four auto-defect triggers (`fn_check_item_to_defect`, `fn_acb_reading_to_defect`, `fn_nsx_reading_to_defect`, `fn_test_record_reading_to_defect`) used a bare `ON CONFLICT (col)` that can't match the **partial** unique indexes from migrations 0061/0062. Effect: marking *any* item/reading as "fail" raised Postgres `42P10` and crashed the save — the core on-site workflow. Latent because no real failure had ever flowed through prod (auto-defect tables were empty).
- **Fix:** [migration 0120](supabase/migrations/0120_fix_defect_autocreate_onconflict_partial_index.sql) — restates the index predicate in each `ON CONFLICT` target. No data/index change.
- **Validated** via rolled-back prod probes on **all four** paths (check item → medium; ACB/NSX/test-record → high via the severity helper), then **applied to prod** (advisors: 0 ERROR, security + performance). Re-proven by the demo seed: the failed item auto-created its defect.
- **Regression guard:** [tests/integration/triggers/auto-defect-from-fail.test.ts](tests/integration/triggers/auto-defect-from-fail.test.ts) exercises all four paths + the `ON CONFLICT DO UPDATE` branch against real Postgres (`npm run test:integration`). It fails loudly if the `WHERE <col> IS NOT NULL` predicate is ever dropped again — a unit test can't catch this, the bug is entirely in the trigger.

### P0-1 · Seed scheduled PM work (the core gap)
- **Demo practice space:** ✅ seeded to prod (idempotent `demo-practice-space.sql`) — DEMO customer + 8 assets + 3 lifecycle checks + 2 manual defects + 1 auto-defect. SKS defects register 0 → 3.
- **Real PM checks:** pending — SKS already has real scheduled/in-progress checks (Equinix SY1/2/3, Metronode SY6/7, Jemena Cardiff/Mittagong, Digital Realty SYD11), some stale/test entries mixed in. Week-1 scope is Royce's visit plan; `batchCreateChecksAction` is the generation path.
`pm_calendar` and live checks are empty. Techs need real work waiting on day-1.
- Generate maintenance_checks from job plans for the first 1–2 weeks of SKS sites (the assets + plans + frequency items already exist — this is generation, not data entry).
- Confirm checks surface on `/admin/pm-calendar` and `/admin/today`.
- **Acceptance:** ≥1 scheduled check per tech against a real SKS site, visible on the calendar and in `/do`.

### P0-2 · Attach orphaned SKS user
`mark.brame@sks.com.au` exists in `profiles` with no `tenant_members` row → hits the access gate.
- Attach via `/admin/users` (or pre-attach SQL per `sks-golive-tenant-seed.md`).
- Sweep `profiles` for any other real SKS person unattached.
- **Acceptance:** every real SKS email resolves to the SKS tenant; zero unexpected orphans.

### P0-3 · Security verify — cross-tenant isolation
The shipped C6 impl (#233/#234) differs from the `nostalgic-bouman` branch that claimed to "close the cross-tenant super_admin hole." Confirm the merged code actually closes it.
- Manual check: a `manager` in one tenant cannot read/write another tenant's rows (assets, checks, members).
- Confirm `EQ_PLATFORM_ADMIN_KEY` gating behaves (env is referenced on main; `lib/api/platform.ts` is not — verify there's no dangling super-admin path).
- **Acceptance:** documented pass on a 2-tenant read/write probe; advisors still 0 ERROR.

### P0-4 · Idempotency on field-critical actions
`withIdempotency()` covers maintenance + reports but **not ACB/NSX test saves** — the highest on-site duplicate-write risk on flaky venue networks.
- Wrap ACB step-3 save and NSX step-3 save with `mutationId` + matching audit insert.
- **Acceptance:** double-submit of an ACB/NSX save produces one row, one audit entry.

### P0-5 · End-to-end dress rehearsal on prod
Run the `onboarding-day.md` T-1 smoke test for real, on every workflow:
- Sign in on phone → open a real check → in_progress → pass/fail an item → upload photo → raise defect → Complete → generate customer report + run-sheet → verify SKS branding + real data.
- Do this once per kind: PPM, ACB, NSX, RCD.
- **Acceptance:** clean run of all four; reports render correctly on a real computer (not browser PDF preview).

---

## P1 — should ship (decisions locked 2026-06-06)

### P1-1 · Floating ACB/NSX test history → **archive now, back-link later** ✅ decided
453 ACB + 254 NSX tests are owned by SKS but not linked to any `maintenance_check`.
- **Go-live:** leave as-is, label explicitly as imported history, exclude from "incomplete check" views so they don't read as outstanding work. No data churn the week before launch.
- **Fast-follow (post-launch):** back-link historical tests to checks (or generate archive checks) so history surfaces in-workflow and in reports. Scoped as its own ticket.
- **Acceptance (go-live):** historical tests never appear as "incomplete" anywhere; no tech sees phantom outstanding work.

### P1-2 · UX go-live items → **already merged; stragglers cleaned** ✅ done 2026-06-06
Investigation (Rule 0.5 — verify live, not the branch) found **both branches are already fully on main** via the UX-audit PRs (#149 et al.):
- `feat/pr-a-tech-permission-dashboard-sidebar` — TechDashboard, role-aware sidebar (techs lose Records + Insight), Mine/All toggle, `canDoTestWork` all present on main.
- `feat/pr-f-maintenance-plan-rename` — "Job Plan" → "Maintenance Plan" present across job-plans page, Sidebar, records, forms. (The earlier "pending" read was a three-dot-diff artifact comparing to merge-base, not main's tip.)
- A cherry-pick of pr-f onto main collapsed to ~zero, confirming it. **No merge needed.**
- Cleaned the 3 user-facing display-string stragglers the sweep missed (asset detail label, setup-checklist copy, two create-check validation errors). Left the Maximo paste hints, API `notFound` labels, parser, and compliance-PDF labels as-is (out of scope). Commit `6d9baf3`; `npm run check` green.

### P1-3 · Merge #240
`fix(analytics): use canonical email as PostHog distinct_id` — based on main, single commit, safe. Merge so day-1 analytics attribute correctly.

### P1-4 · Doc de-stale (30 min)
- Close `30-day-plan.md` A3 (ABN done); move closed items to a "Done 2026-06" section.
- Refresh `ARCHITECTURE.md` (still references dropped `testing_checks`) and append the missing month to `CHANGELOG.md`.

### P1-5 · Pre-visit tech brief — **full Phase 1** ✅ decided
Build the complete enriched brief (per `runbooks/pre-visit-tech-brief-spec.md`): composer + email template (visit details, map link, site contact, access notes, scope summary, asset count, prior-visit summary, weather), ICS generator, run-sheet DOCX attachment, "Send brief" button (admin/supervisor), bell notification, opt-out preference. Phase 0 (`scheduled_start_at` + assignment) is already live underneath it. Phase 2 (cron auto-send) stays deferred.
- **Time budget — flag:** this is the single largest item, ~4–5 of the 15 days. It runs **alongside** P0, and **must not displace P0-5 (dress rehearsal)** — if it slips, it ships the stripped composer-only version, not a slipped rehearsal. Day-1 functionality does not depend on it.
- **Acceptance:** an admin/supervisor can send an enriched brief for an assigned visit; tech receives email + bell + ICS + run-sheet; opt-out respected.

---

## P2 — explicitly deferred post-launch (not blockers)

- **Pre-visit tech brief Phase 2** (cron auto-send at 17:00 day-before + reschedule handling) — Phase 1 is in scope (P1-5); the scheduler follows post-launch.
- **Back-link historical ACB/NSX tests to checks** — the fast-follow half of P1-1's decision.
- Idempotency on contacts-import / admin user-create (lower field risk than P0-4).
- Cross-tenant **enforcement** test (fixture-user automated); static `npm run audit:rls` already passes.
- Saved filters / per-user prefs · PWA offline queue · scheduling-dispatch board.
- Per-asset technician sign-off block + outstanding-work-orders count on report cover (compliance polish).
- EQ Shell Phase 2 (canonical migration) / Phase 3 (Shell port) — months out by design.

---

## Day-of execution
Already specified in `docs/runbooks/onboarding-day.md` — fold it in unchanged. Key gates: pre-attach roster T-3h, sample report verified T-3 days, `/admin/today` + `/admin/activity` on wall display, demo practice space seeded, backup ZIP before **and** after the day.

---

## Sequencing (T-15 → T-0)

**Track 1 — go-live spine (must finish):**
1. **Now → T-12:** P0-2 (orphan), P0-3 (security verify), P1-3 (#240), P1-4 (docs), P1-1 (archive-label historical tests) — clear-the-decks.
2. **T-12 → T-7:** P0-4 (idempotency), P0-1 (seed PM work), P1-2 (rebase + merge both UX branches).
3. **T-7 → T-3:** **P0-5 dress rehearsal** on all four workflows; fix what it surfaces. *This is the immovable gate.*
4. **T-3 → T-0:** runbook (`onboarding-day.md`) — roster pre-attach, sample report, backups.

**Track 2 — tech brief (parallel, P1-5):** full Phase 1 build runs alongside Track 1 from ~T-13. **Hard rule:** it yields to Track 1. If it can't finish without eating P0-5 rehearsal time, it ships composer-only and the rest follows post-launch. Day-1 does not depend on it.

**Risk: MEDIUM.** Foundation + auth are done and proven; the go-live spine is low-novelty seeding/rehearsal. The added risk is concentrating ~4–5 days on the full tech brief (P1-5) inside a 15-day window — it competes with the spine for attention. Mitigation: Track 2 is explicitly subordinate to Track 1, and the dress rehearsal (P0-5) is a non-negotiable gate.
