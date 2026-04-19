# CHANGELOG — EQ Solves Service

All notable changes to this project are logged here. Appended by Cowork at the end of every session.

---

## 2026-04-19 — Maintenance bulk-delete fix + card title polish

Merged to `main`.

### Fixed
- **Bulk delete on `/maintenance` blocked by FK constraint** — `report_deliveries.maintenance_check_id` had `ON DELETE NO ACTION`, so any bulk delete that caught a check with an emailed-report history failed with `violates foreign key constraint report_deliveries_maintenance_check_id_fkey`. Migration `0055_report_deliveries_cascade_on_check_delete.sql` swaps it to `ON DELETE CASCADE`, matching the behaviour of `check_assets` and `maintenance_check_items`. `defects.check_id` stays on `SET NULL` — defect records outlive the check that spawned them.

### Changed
- **Site-grouped kanban card title** — on `/maintenance` → Site view, the card title was the job plan code (e.g. `E1.3`) which duplicated information you can already see at a glance. Title is now the due date's month + year (`August 2025`) and the job plan code moves down to a tag row alongside frequency + dark-site flag, rendered in the EQ ice/deep palette. Site is already the card header, so the title now answers "*when*" while the tags answer "*what kind*".

### Files Touched
- Created: `supabase/migrations/0055_report_deliveries_cascade_on_check_delete.sql`
- Modified: `app/(app)/maintenance/SiteGroupedView.tsx`

---

## 2026-04-19 — Bulletproof user invite/creation flow

Merged to `main`.

### Fixed
- **"Database error saving new user" on invite** — root cause: `handle_new_user()` trigger from migration 0046 referenced a non-existent `ts.created_at` column on `tenant_settings`, which caused the insert into `auth.users` to roll back. Supabase Auth surfaced this as a generic "Database error" to the invite API.
- **`supabase/migrations/0053_bulletproof_user_creation.sql`** — rewrote `handle_new_user()` to (a) only upsert `public.profiles` (never fail the auth insert), (b) wrap the body in `EXCEPTION WHEN OTHERS` so any future schema drift logs a warning instead of breaking signup, (c) default role to `technician`, promote `dev@eq.solutions` and `royce@eq.solutions` to `super_admin` automatically. Tenant-assignment logic moved out of the trigger and into the server action where it belongs. Backfill fixes demo-user role (`'user'` → `'super_admin'`) and demotes any stale `'user'` rows to `'technician'`.
- **Invite email pointed at `localhost`** — `inviteUserAction` and `resendInviteAction` now send `redirectTo = ${origin}/auth/callback?next=/auth/reset-password` so the PKCE code is exchanged before the user lands on the reset page. Matches the forgot-password flow and prevents the "Auth session missing" error on reset.

### Added
- **Client-side hash-token fallback on reset page** — if the user arrives via the implicit flow (`#access_token=…&refresh_token=…`), `ResetPasswordForm` now calls `supabase.auth.setSession()` to materialise the session cookie before submit, then strips the hash from the URL so a refresh can't replay the tokens. `sessionReady` state gates the submit button until a valid session exists.
- **Orphan repair UI on `/admin/users`** — users with a `profiles` row but no `tenant_members` row now show a "No tenant" amber badge with an Attach button that wires them into the current tenant via `repairUserTenantAction`. Resend button re-sends the invite email via `resendInviteAction`.
- **`repairUserTenantAction` / `resendInviteAction`** — idempotent server actions for common admin operations. Both use the standard `requireUser()` → role check → Zod → mutation → audit-log → `revalidatePath()` pattern.

### Changed
- **`app/(app)/admin/users/actions.ts`** — split into helper functions: `requireTenantAdmin()`, `findAuthUserByEmail()`, `upsertProfile()`, `upsertTenantMembership()`, `friendlyAuthError()`. `inviteUserAction` is now authoritative and idempotent — safe to retry, handles new + existing + orphaned users without branching the caller.
- **`app/(app)/admin/users/page.tsx`** — replaced the (broken) `profiles.select('tenant_members(...)')` join with two parallel queries stitched in app code. There's no FK between `profiles` and `tenant_members` (both FK to `auth.users`), so the PostgREST join fails silently. Stitched join exposes `has_tenant_membership` per row for the orphan UI.

### Operational follow-ups (not code)
- Supabase dashboard → Auth → URL Configuration → set Site URL to `https://eq-solves-service.netlify.app` and add the Netlify URL + any preview branches to Redirect URLs allowlist.
- Invite/reset email templates still need an EQ-branded refresh (separate session).

### Files Touched
- Created: `supabase/migrations/0053_bulletproof_user_creation.sql`
- Modified: `app/(app)/admin/users/actions.ts`, `app/(app)/admin/users/page.tsx`, `app/(app)/admin/users/UsersTable.tsx`, `app/(app)/admin/users/InviteUserForm.tsx`, `app/(auth)/auth/reset-password/ResetPasswordForm.tsx`

---

## 2026-04-19 — Delta/Equinix Maximo work-order Excel import

Merged to `main`.

### Added
- **`lib/import/delta-wo-parser.ts`** — pure parser for the monthly Delta work-order `.xlsx` Equinix sends from Maximo. Strips `AU0x-` site prefix, splits job plans on the last dash, maps Delta frequency suffixes to the EQ frequency enum (`A`→annual, `Q`/`3`→quarterly, `M`→monthly, `S`/`6`→semi_annual, `W`→weekly, `2`/`5`/`10`→n-yr). Fail-closed on unknown frequency. Deterministic grouping by `(site, jp_code, frequency, start_date)`.
- **`lib/utils/levenshtein.ts`** — two-row DP edit-distance helper + `closestMatch()`. Powers fuzzy job-plan-code suggestions (e.g. MVSWBD→MVSWDB). Suggestions only; never auto-applied.
- **`app/(app)/maintenance/import/page.tsx`** — role-guarded (`canWrite`) entry page with breadcrumb.
- **`app/(app)/maintenance/import/ImportWizard.tsx`** — client wizard: upload → preview → commit. Group cards show per-asset resolution status, duplicate-WO flags, blocker/warning banners, sticky commit bar.
- **`app/(app)/maintenance/import/actions.ts`** — server actions:
  - `previewDeltaImportAction` parses the workbook, resolves sites by code, job plans by code (with tenant alias + fuzzy fallback), assets by `(site_id, maximo_id)`, and flags duplicate WO numbers.
  - `commitDeltaImportAction` wrapped in `withIdempotency`. Re-parses the workbook server-side — never trusts the client preview payload. Refuses wholesale if any blocker exists (unresolved site, unresolved plan, unknown frequency, unmatched asset, duplicate WO). Preloads `job_plan_items` per distinct `(jobPlanId, frequencyColumn)` pair. Per group inserts `maintenance_checks` → `check_assets` (with `work_order_number`) → batched `maintenance_check_items`. Audit log row carries the `mutationId`.
- **`supabase/migrations/0049_job_plan_aliases.sql`** — tenant-scoped alias table (`source_system: delta|maximo|manual`) for remapping unknown upstream codes and accepted fuzzy matches. RLS enabled with tenant-scoped read + writer-role write policies.
- **`supabase/migrations/0050_check_assets_wo_unique_idx.sql`** — partial unique index on `check_assets(tenant_id, work_order_number) WHERE work_order_number IS NOT NULL`. DB backstop for duplicate detection.
- **`tests/lib/import/delta-wo-parser.test.ts`** — 27 tests (site prefix, job plan split, frequency map, group key, full workbook parse against the Aug 2025 fixture).
- **`tests/lib/utils/levenshtein.test.ts`** — 11 tests.

### Changed
- **`app/(app)/maintenance/MaintenanceList.tsx`** — Import button added before Create Check (toolbar convention: Import left).
- **`app/api/pm-asset-report/route.ts`** — passes `ca.work_order_number` into `PmAssetSection`.
- **`lib/reports/pm-asset-report.ts`** — `PmAssetSection.workOrderNumber` renders in the asset metadata table alongside Job Plan on the PM Asset Report.

### Verified
- 38/38 unit tests pass. `tsc --noEmit` clean.
- Supabase security advisors: 0 new ERROR-level findings.
- Supabase performance advisors: only INFO-level "unused index" findings on the brand-new `job_plan_aliases` table (expected — no traffic yet).

### Pending
- Live dry-run on SKS tenant with the Aug 2025 Delta file: confirm ~250 rows resolve, MVSWBD fuzzy prompt fires, LBS unknown-code prompt works, commit succeeds, re-upload triggers the duplicate blocker.

---

## 2026-04-19 — IP hardening pass

Merged to `main`.

**Driver:** EQ IP Protection & Commercialisation amendment (18 Apr 2026). Operationalises register items 4, 6, 8, 9, 10, 11, 12 and lays header groundwork for item 7.

### Added
- **`components/ui/EqFooter.tsx`** — medium-form copyright footer (`© {year} EQ · CDC Solutions Pty Ltd · ABN 40 651 962 935 · All rights reserved.`) with link to `/terms`. Rendered in every route group.
- **`components/ui/EqAttribution.tsx`** — persistent bottom-right sticky "Powered by EQ" anchor linking to `https://eq.solutions` with tooltip. Mounted at `app/layout.tsx` so it appears on every page regardless of tenant skin.
- **`app/loading.tsx`** — root loading splash: EQ logo + "Loading EQ Solves Service…". Paints before tenant skin resolves, satisfies register item #12 (pre-auth EQ branding).
- **`app/terms/page.tsx`** — plain-English Terms of Use (9 sections, ~500 words): ownership, licensed-not-sold, customer data ownership, no reverse-engineering, confidentiality, governing law = Australia. Linked from every footer. **Draft — needs Webb / SaaS-lawyer review before commercial reliance.**
- **`supabase/migrations/0048_eq_meta.sql`** — singleton `_meta` table with `product_owner` / `trading_as` / `product_name` / `tenant` / `legal_acn` / `legal_abn`. Seeds `CDC Solutions Pty Ltd` / `EQ` / `EQ Solves Service` / `sks-technologies`. RLS enabled, read-only for `anon`+`authenticated`, writes via service-role only. **NOT applied.** Apply to `urjhmkhbgaxrofurpbgc` (dev) and again to Service prod when that project is created.

### Changed
- **`app/layout.tsx`** — added Next `Metadata` fields: `applicationName: 'EQ Solves Service'`, `authors: [{ name: 'CDC Solutions Pty Ltd' }]`, `publisher: 'EQ'`, `other.copyright`. Mounts `EqAttribution` inside `<body>`.
- **`app/(app)/layout.tsx`** — wrapped `<main>` in a flex column so `EqFooter` sits below the main content area on every authenticated page. Sidebar and tenant skin untouched.
- **`app/(auth)/layout.tsx`** — upgraded the brand-panel copyright from `© {year} EQ Solutions` to the long-form ownership disclosure including ACN + ABN. Added `EqFooter` to the form panel. No changes to auth logic.
- **`app/(portal)/layout.tsx`** — converted to a flex column and mounted `EqFooter`.
- **`package.json`** — set `"license": "UNLICENSED"`, `"author": "CDC Solutions Pty Ltd"`, added proprietary description string. `"private": true` was already set.
- **File headers** added to: `app/layout.tsx`, `app/(app)/layout.tsx`, `app/(auth)/layout.tsx`, `app/(portal)/layout.tsx`, `proxy.ts`, `lib/supabase/middleware.ts`, plus every new file listed above. Per agreed scope: new files + top-level entry points only — not a full backfill of every existing `.ts/.tsx`.

### Not changed (intentional)
- No auth-flow logic changed (proxy.ts rules untouched).
- No tenant-scoped DB schema changes.
- Existing file backfill with headers (P2 #7 full-repo) deferred — touches hundreds of files, needs a dedicated session.
- Webb TM filing (P2 #13), SKS IP email (P1 #1), repo visibility audit (P1 #2), GitHub MCP unblock (P1 #5) — remain on Royce's plate.

### Verification
- `tsc --noEmit` ran clean (0 errors).
- Secret sweep (`SUPABASE_SERVICE_ROLE` / `eyJ…` / `sbp_` / `ghp_` / `sk-` patterns) — only env-var **names** referenced in code, no literal key values.
- **IP check:** Headers ✓ | Secrets ✓ | Repo private ✓ (assumed — needs Royce's visibility audit per P1 #2 to confirm).
- **Status:** Merged to `main` 2026-04-19. Migration `0048_eq_meta.sql` applied to `urjhmkhbgaxrofurpbgc`.

---

## 2026-04-16 — SY1 reconciliation against Delta Elcom master file

### Fixed
- **Migration `0043_sy1_reconciliation.sql`** — reconciled the asset table against the live Delta Elcom master export (`Active Assets 8-04-2026 5-34-22 PM.xlsx`, 4795 rows) via `(name, maximo_id)` composite join. Findings: migration 0038's address-based reassignment sent 377 ex-SY1 assets to active SY3, but the live system has them on active SY1 (639 Gardeners Rd, Mascot). Of those 377, three were day-one seed rows with no master-file entry. Actions:
  - **Moved 374 assets SY3 → active SY1.** Every id pinned from the master-file match — no address guessing this time.
  - **Hard-deleted 7 demo/orphan assets** that do not appear in the master file at all: `ACB - SY1` (orphan maximo 1234, SY2), `ACB-SY1-001` (SY2), `ACB-SY4-001`/`ACB-SY4-002` (SY4), `NSX-SY1-001`/`PDU-SY1-001`/`UPS-SY1-001` (SY3). Dependent `acb_tests` (1) and `test_records` (1) also hard-deleted. No readings, defects, check_assets, job_plan_items, maintenance_check_items or nsx_tests touched.
  - **Left 84 SYD11 + 1 STG rows alone** — they appear as drift in the join but are whitespace-only differences in the master export (trailing space on name / maximo_id). Cosmetic, not real.
  - Sanity checks raise on any deviation from target: SY1=374, SY2=186, SY3=869, SY4=109, total=4721. All passed on apply.
- **Post-state matches master file exactly.** Verified independently post-apply:

  | Site | Before | After | Δ |
  |---|---|---|---|
  | SY1 | 0 | **374** | +374 |
  | SY2 | 188 | **186** | −2 demos |
  | SY3 | 1,246 | **869** | −374 moved, −3 demos |
  | SY4 | 111 | **109** | −2 demos |
  | All others | — | unchanged | — |
  | **Total active assets** | 4,728 | **4,721** | −7 |

- Closes the backlog item flagged in the 2026-04-15 audit report ("10 active assets with null `job_plan_id`") — 7 of those 10 were the demo rows deleted here; the remaining 3 on SYD11/SY6 are real assets pending manual job plan assignment.

---

## 2026-04-15 (overnight) — Data hygiene pass: orphan reassign, customer consolidation, address correction, FK indexes

### Fixed
- **Migration `0038_reassign_orphan_assets_and_harden_grouping.sql`** — Assets page grouped view and Sites page had diverged because 488 live assets were still attached to soft-archived SY1/SY4 parent rows from a 2026-04-08 renumber. Reassigned 377 assets off archived SY1 (47 Bourke Rd) → active SY3, 111 assets off archived SY4 (17 Bourke Rd, data-entry error) → active SY4 (200 Bourke Rd). Hard-deleted 4 orphan assets and the archived MEL1 site row (Royce confirmed not managed; pre-check zero dependents across every FK-referencing table).
- **Hardened `get_assets_for_grouping` RPC** — added `and (a.site_id is null or s.is_active = true)` so assets on archived parent sites can never silently inflate the grouped-view counts again. Sanity `DO` block fails the migration loudly if any active asset remains on an archived site.
- **Migration `0039_clean_demo_data_off_real_sy1.sql`** — cleaned seed cruft off the real imported SY1 ahead of live data. Hard-deleted 15 `pm_calendar` rows all created at the identical microsecond `2026-04-10 06:31:00.879416+00` (full FY25-26 PM program seed) and the "Test" `maintenance_check` `955dcf82-...`. Sanity check asserts SY1 is now empty of assets / pm_calendar / maintenance_checks.
- **Migration `0040_customer_consolidation.sql`** — customer records now match real ABN-registered legal entities per Royce's mapping:
  - `Equinix Australia Pty Ltd` → SY1, SY2, SY3, SY4, SY5
  - `Metronode NSW Pty Ltd` → SY6, SY7 (renamed from `Metronode NSW`)
  - `Equinix Hyperscale` → SY9 *(new)*
  - `Equinix Australia National` → CA1 *(new)*
  - `Ramsay Health` → St George Private Hospital *(new; previously null customer_id with 20 orphan assets)*
  - Legacy catch-all `Equinix Australia` soft-archived once empty (audit trail preserved — no hard delete). Sanity checks assert every expected site sits on its expected customer and zero active sites have null `customer_id`.
- **Migration `0041_address_corrections.sql`** — populated `code`, `address`, `city`, `state`, `postcode` for all 12 active sites in Royce's tenant. Key corrections: **SY7** city `Sydney` → `Wollongong` (Unanderra is Wollongong, not Sydney); **SY9** added Camellia NSW 2142; **SY3/SY4/SY5** Alexandria NSW 2015; **St George** `STG` / Kogarah NSW 2217; **CA1** Mitchell ACT 2911. Sanity check asserts zero null `code` / `city` / `postcode` after migration.

### Performance
- **Migration `0042_fk_covering_indexes.sql`** — added covering indexes for every foreign key in `public` flagged by the Supabase `unindexed_foreign_keys` advisor (83 constraints across 28 tables: acb/nsx tests, assets, attachments, audit_logs, check_assets, contract_scopes, customer_contacts, customers, defects, instruments, job_plans/items, maintenance_checks/items, media_library, notifications, pm_calendar, site_contacts, sites, tenant_members, test_records/readings, testing_checks, etc). Verified post-state: zero unindexed FKs remain. Non-concurrent CREATE INDEX is fine — largest referencing table is ~1250 rows.

### Data audit (2026-04-15, tenant `ccca00fc-...`)
All checks clean except one known backlog item:
- 0 assets with null site / 0 assets on archived site / 0 assets on archived customer
- 0 sites with null customer / 0 sites on archived customer
- 0 defects with null asset / 0 tests on archived asset (acb / nsx / test_records)
- 0 duplicate customers / sites / assets by natural key
- 0 `updated_at < created_at` rows across assets/sites/customers/defects/maintenance_checks
- Security & performance advisors clean of ERROR-level findings; remaining WARN findings (anon INSERT on `briefs`/`estimates`/`estimate_events`, service insert on `notifications`, public bucket listing on `logos`) are all pre-existing documented exceptions in `AGENTS.md`.
- **Backlog**: 10 active assets still have null `job_plan_id` — 3 on SY3 (NSX/PDU/UPS, ex-SY1 seed leftovers), 2 on SY4 (ACB), 1 on SY6 (SCADA), 4 on SYD11 (MCC NSX250N). Not auto-fixed — Royce to assign correct plan.

### Post-state snapshot
- 7 active customers, 1 soft-archived (legacy catch-all), 12 active sites, 4728 active assets
- Asset distribution: CA1 159 · STG 20 · SY1 0 · SY2 188 · SY3 1246 · SY4 111 · SY5 303 · SY6 595 · SY7 303 · SY9 507 · SYD10 279 · SYD11 1017
- `tsc --noEmit` → 0 errors

### Context
Royce flagged divergence between Assets page and Sites page asset counts and handed the night to do as much data checking, parsing and audit work as possible ahead of live customer data landing. Push policy: no auto-push — everything staged for Royce to review and push in the morning.

---

## 2026-04-15 — Fix: super_admin ambushed by OnboardingWizard + six screenshot fixes

### Fixed
- **`app/(app)/layout.tsx`** — tenant membership lookup was `.limit(1).maybeSingle()` with no ordering, so Postgres could return any membership row. An admin/super_admin whose roulette-pick happened to land on a tenant with `setup_completed_at = NULL` was force-rendered into `<OnboardingWizard>` ("create your own project"). Rewrote to fetch all active memberships joined to their tenant setup state, prefer one that's already onboarded, and fall back deterministically to the earliest-joined membership. The wizard now only shows if *every* tenant the user belongs to is un-onboarded.
- **Data fix (manual SQL)** — stamped `tenants.setup_completed_at = now()` on Demo Electrical (`a0000000-0000-0000-0000-000000000001`); it was fully seeded but never marked complete. Upgraded `simon.bramall@sks.com.au` from `admin` → `super_admin` on the same tenant.
- **Dashboard & Sites asset counts** — `app/(app)/dashboard/page.tsx` and `app/(app)/sites/page.tsx` were using PostgREST embedded `assets(count)` which ignores the parent `is_active=true` filter on the nested resource, so archived assets were being counted. Replaced with a separate filtered query keyed on `site_id` and grouped into a Map. Dashboard map-pin counts and `/sites` list counts now reconcile with the true `/assets` register.
- **Sidebar logo oversized** — `components/ui/Sidebar.tsx` header was `h-24` with an `h-20 w-auto` image. Reduced header to `h-16` and constrained logo to `max-h-10 max-w-[140px]` so custom tenant logos can't blow out the column.
- **Customer logo placement** — `app/(app)/customers/[id]/page.tsx` now renders the customer logo (or initial-letter fallback) inline next to the h1 in the header. `app/(app)/sites/[id]/page.tsx` selects `customers(name, logo_url)` and shows a 28px logo next to the customer name in the info grid.
- **Media library click-to-edit** — `app/(app)/admin/media/MediaLibraryClient.tsx` cards are now clickable. Opens an edit modal with Name, Category, and Linked-to (customer/site) fields, wired to the existing `updateMediaAction`. Delete button uses `stopPropagation()` to avoid opening the modal.

### Added
- **Remove user from tenant** (`app/(app)/admin/users/`) — new `removeUserFromTenantAction` soft-deletes the `tenant_members` row (`is_active=false`) scoped to the current tenant, leaving the auth account and other tenant memberships intact. Follows AGENTS.md soft-delete convention; admin-only via `isAdmin(role)`; cannot remove yourself. `UsersTable.tsx` gains a red "Remove" button with confirm dialog next to Deactivate, plus an inline error banner if the action fails.
- **NSX "Create Check"** (`app/(app)/testing/nsx/page.tsx`) — mirrors the ACB flow. New toolbar button opens a dedicated view with frequency/month/year dropdowns, asset-selection table (untested selectable, already-tested greyed out), and a Create button that calls the existing `createTestingCheckAction` with `check_type: 'nsx'`. Created checks appear in `/testing/summary` alongside ACB and General.

### Context
- Triggered by Simon Bramall logging in 2026-04-15 and being dropped into the onboarding wizard instead of Demo Electrical, plus six follow-up issues Royce flagged from a screenshot.

---

## [Sprint 29] 2026-04-12 — Items Register, Frequency Editing, Idempotency, CheckDetail Refactor

### Added
- **Job Plan Items Master Register** at `/job-plans/items` — flat table of every task across every active job plan. Columns: Code · Plan · Site · # · Task · Frequency · Required. In-memory filters (search, plan, site, frequency, required), sortable columns, CSV export with one Y/blank column per frequency for clean Excel pivots. Inline frequency editor: click any frequency cell → checkbox grid (DS · M · Q · 6M · A · 2Y · 3Y · 5Y · 8Y · 10Y) → optimistic update with rollback on failure
- **Frequency column on Job Plan edit panel** — read-mode shows compact `FrequencyBadges`, edit-mode shows checkbox grid. Saves all 10 boolean flags alongside description / sort_order / required
- **Shared `FrequencyBadges` component** (`components/ui/`) — compact badge strip showing active frequencies. Single source of truth for short labels (M / Q / 6M / A / 2Y–10Y) and dark-site marker (DS). Used by both register and edit panel
- **Mutation ID idempotency** — `withIdempotency()` wrapper in `lib/actions/idempotency.ts` for replay-safe server actions. Partial unique index `idx_audit_mutation_id_unique` on `audit_logs (tenant_id, mutation_id)`. Foundation for offline sync and AI-suggested actions. Pattern documented in `AGENTS.md`
- **Shared site-health analytics** at `lib/analytics/site-health.ts` — `computeMaintenanceCompliance`, `computeComplianceBySite`, `computeSiteHealthScore` (green/amber/red tiers). `/reports` now consumes shared primitives
- **CheckDetail refactor** — 553-line monolith split into `TaskRow.tsx`, `AssetRow.tsx`, `CheckAssetTable.tsx`, `CheckHeader.tsx`. CheckDetail.tsx ~240 lines, thin orchestrator. Zero behaviour changes
- **Items Register link** on `/job-plans` page header
- **CRLF/LF normalization** via `.gitattributes` — fixes 1,211-file CRLF drift
- **GitHub Actions CI** at `.github/workflows/ci.yml` — runs `tsc --noEmit` + `npm audit --audit-level=high` on push and PR to main

### Removed
- **Per-item reference image feature** — migration 0030 drops `reference_image_url`/`reference_image_caption` from `job_plan_items` and `maintenance_check_items`, removes `job-plan-references` storage bucket. Generic image components (`ImageUpload`, `ImageThumbnail`, `ImageLightbox`) retained in `components/ui/` for future photo-evidence use

### Fixed
- Bumped `next` from 16.2.2 → 16.2.3 to clear GHSA-q4gf-8mx6-v5v3 (DoS in Server Components)
- `updateCheckItemAction` was missing audit log — added with `withIdempotency` retrofit

### Files Created
- `supabase/migrations/0028_mutation_id_idempotency.sql` (applied)
- `supabase/migrations/0029_job_plan_reference_images.sql` (applied then reverted by 0030)
- `supabase/migrations/0030_drop_reference_images.sql` (pending user application)
- `lib/actions/idempotency.ts`
- `lib/analytics/site-health.ts`
- `components/ui/FrequencyBadges.tsx`
- `components/ui/ImageUpload.tsx`, `ImageThumbnail.tsx`, `ImageLightbox.tsx`
- `app/(app)/job-plans/items/page.tsx`, `JobPlanItemsRegister.tsx`
- `app/(app)/maintenance/TaskRow.tsx`, `AssetRow.tsx`, `CheckAssetTable.tsx`, `CheckHeader.tsx`
- `.gitattributes`
- `.github/workflows/ci.yml`

### Files Modified
- `app/(app)/job-plans/JobPlanForm.tsx` — frequency column + removed image control
- `app/(app)/job-plans/JobPlanList.tsx` — Items Register link
- `app/(app)/job-plans/actions.ts` — partial-update for frequency flags
- `app/(app)/maintenance/CheckDetail.tsx` — slimmed to orchestrator
- `app/(app)/maintenance/actions.ts` — removed reference snapshot, added idempotency + audit to `updateCheckItemAction`
- `app/(app)/reports/page.tsx` — consumes shared analytics
- `lib/actions/audit.ts` — accepts `mutationId`, exports `isMutationProcessed`
- `lib/types/index.ts` — removed reference fields from `JobPlanItem` and `MaintenanceCheckItem`
- `lib/validations/job-plan.ts` — extended with 10 frequency flags + `dark_site`
- `package.json` / `package-lock.json` — next 16.2.3
- `AGENTS.md` — `withIdempotency()` pattern
- `AI_STRATEGY.md` — phasing reset, revised Phase 1a

---

## [Sprint 28] 2026-04-10 — NSX Workflow, Testing Summary, Reports Expansion, Maintenance UX

### Added
- **NSX 3-step workflow** — mirrors ACB pattern. Migration `0026_nsx_workflow.sql` adds `step1_status`/`step2_status`/`step3_status` plus extended asset-collection columns (brand, breaker_type, name_location, current_in, fixed_withdrawable (fixed/withdrawable/plug_in), protection_unit_fitted, trip_unit_model, long/short-time protection, instantaneous, earth fault, and accessory voltages). New `NsxWorkflow.tsx` component with Step 1 Asset Collection form and Step 2/3 placeholders. `/testing/nsx` page rewritten as a site-based workflow (job-plan lookup by name 'NSX' or code 'LVNSX'/'MCCB')
- **Testing Summary register** at `/testing/summary` — combined view of ACB, NSX and General test records with site / kind / status / date filters, 4 KPI cards, progress bars, and direct links into each workflow
- **Maintenance checklist print — Simple vs Detailed** — Simple format outputs a single asset register table (asset ID, name, location, WO #, done, notes); Detailed format retains the current per-asset breakdown. `/api/maintenance-checklist` accepts a `format` query param
- **Maintenance kanban archive / delete** — hover-visible Archive and Cancel buttons on each kanban card (admins only), wired into `archiveCheckAction` and `cancelCheckAction`
- **Cancelled status badge** — distinct variant replacing the misleading 'blocked' label previously shown for cancelled maintenance checks
- **Reports expansion** — ACB & NSX workflow progress cards, defects register summary (totals by status + severity), maintenance compliance by site (top 10), and a 6-month tests/maintenance trend chart
- **Job Plans detail** — clicking a row now opens a wider slide panel (`wide`) with a full items table (columns #, Description, Required, Actions) for easier editing
- **ACB Import Excel button** — visual parity with Export Excel / Asset Collection buttons (hidden `<input>` triggered by a `<Button>`)
- **Testing nav reorder** — "General Testing (under development)" moved to the right of the nav

### Files Created
- `supabase/migrations/0026_nsx_workflow.sql`
- `app/(app)/testing/nsx/NsxWorkflow.tsx`
- `app/(app)/testing/summary/page.tsx`

### Files Modified
- `lib/types/index.ts` — extended `NsxTest` interface
- `app/(app)/nsx-testing/actions.ts` — added `updateNsxDetailsAction`
- `app/(app)/testing/nsx/page.tsx` — rewritten as site-based workflow page
- `app/(app)/testing/TestingNav.tsx` — tab reorder + Summary entry
- `app/(app)/testing/acb/page.tsx` — import button consistency
- `app/(app)/reports/page.tsx` — workflow progress, defects, site compliance, trend chart
- `app/(app)/job-plans/JobPlanForm.tsx` — wide panel + items table
- `app/(app)/maintenance/KanbanBoard.tsx` — archive/delete buttons per card
- `app/(app)/maintenance/MaintenanceList.tsx` — pass isAdmin to kanban
- `app/(app)/maintenance/[id]/CheckDetailPage.tsx` — simple/detailed print links
- `app/api/maintenance-checklist/route.ts` — format param
- `lib/reports/maintenance-checklist.ts` — asset register (simple) branch
- `components/ui/StatusBadge.tsx` — cancelled variant
- Five call sites updated from `'blocked'` → `'cancelled'`

### Verification
- `tsc --noEmit`: 0 errors

---

## [Sprint 27] 2026-04-09 — ACB Testing Rebuild, Asset Collection, Excel Batch Fill

### Added
- **ACB Asset Collection fields** — 22 new columns on `acb_tests` table: breaker identification (brand, breaker_type, name_location, performance_level N1/H1/H2/H3/L1, protection_unit_fitted, trip_unit_model, current_in, fixed_withdrawable), protection settings (long_time_ir/delay, short_time_pickup/delay, instantaneous, earth_fault_pickup/delay, earth_leakage_pickup/delay), accessories (motor_charge, shunt_trip_mx1, shunt_close_xf, undervoltage_mn, second_shunt_trip). Migration `0023_acb_full_asset_collection.sql` (already applied to production)
- **AcbSiteCollection component** — site-level asset collection with expandable cards per CB, conditional protection settings (shown only when protection unit fitted), voltage dropdowns for all accessories
- **AcbWorkflow 3-tab rewrite** — Tab 1 (Asset Collection), Tab 2 (Visual & Functional — 23 items in 5 sections: Visual Inspection, Service Operations, Functional Tests Chassis incl. numeric op counter, Functional Tests Device, Auxiliaries), Tab 3 (Electrical Testing — contact resistance R/W/B with 30% variance warning, IR Closed 7 combos, IR Open 4 combos, temperature, secondary injection, maintenance completion). Default tab is Visual & Functional
- **Excel batch fill** — export pre-populated .xlsx per site with all asset collection fields, import filled spreadsheet to batch-update all CB data. Uses SheetJS (`xlsx` package)
- **Job plan filter on Assets page** — replaced "All Types" dropdown with "All Job Plans" dropdown showing `name - type` (e.g. "E1.25 - Low Voltage Air Circuit Breaker"). Server-side filtering by `job_plan_id`
- **Logos storage bucket** — created in Supabase production with public read, authenticated write/update/delete RLS policies

### Changed
- **ACB testing page** — full rewrite: auto-filters E1.25/LVACB assets per site (global job plan lookup, `site_id` may be null), shows Asset/Type/Collection/V&F/Electrical/Progress/Action columns, "Start Test" creates record and opens workflow, "Continue" resumes existing test
- **Job Plans table** — column labels corrected: "Name" → "Job Plan", "Type" → "Name"
- **Logo upload action** — fixed to use `logos` storage bucket instead of `attachments` bucket
- **updateAcbDetailsAction** — expanded to accept all 22 new asset collection fields
- **AcbTest interface** — added all new fields plus `AcbPerformanceLevel` and `AcbFixedWithdrawable` type aliases
- **CLAUDE.md** — comprehensive project context documentation

### Files Created
- `supabase/migrations/0023_acb_full_asset_collection.sql`
- `app/(app)/testing/acb/AcbSiteCollection.tsx`
- `lib/utils/acb-excel.ts`

### Files Modified
- `lib/types/index.ts` — AcbTest interface + new type aliases
- `app/(app)/acb-testing/actions.ts` — expanded updateAcbDetailsAction
- `app/(app)/testing/acb/page.tsx` — full rewrite
- `app/(app)/testing/acb/AcbWorkflow.tsx` — full rewrite with 3 tabs
- `app/(app)/assets/page.tsx` — job_plan_id filter param + query
- `app/(app)/assets/AssetList.tsx` — job plan dropdown filter
- `app/(app)/job-plans/JobPlanList.tsx` — column label fix
- `app/(app)/admin/settings/actions.ts` — logos bucket fix
- `package.json` — added xlsx dependency
- `CLAUDE.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `ROADMAP.md`, `SPEC.md`

---

## [Sprint 25] 2026-04-09 — Mobile, Defects, Export, Scope Integration & Onboarding

### Added
- **Mobile responsive sidebar** — hidden on mobile with hamburger menu, slide-in drawer with backdrop overlay, auto-close on route change, body scroll lock
- **Defects table** (`supabase/migrations/0018_defects.sql`) — severity levels (low/medium/high/critical), status workflow (open → in_progress → resolved → closed), linked to checks, assets, and sites with RLS
- **Raise/update defect actions** — `raiseDefectAction()` and `updateDefectAction()` in maintenance actions, auto-sets `resolved_at` timestamp
- **CSV data export** — client-side blob download on Assets, Sites, and Customers tables via reusable `ExportButton` component and `exportToCsv()` utility
- **Contract scope integration into check creation** — when creating a maintenance check and selecting a site, a scope info panel shows included/excluded contract items for that customer's current FY
- **User onboarding wizard** — 3-step first-login setup (company details → first site → ready) shown as modal overlay for admin users when `setup_completed_at` is null. Skip option available. Migration `0019_onboarding.sql` adds flag to tenants table
- **Onboarding server actions** — `updateCompanyDetailsAction`, `createFirstSiteAction`, `completeOnboardingAction`, `skipOnboardingAction`
- **Notification type** — added `defect_raised` to notification type union

### Changed
- **Sidebar navigation** — removed separate ACB/NSX Testing links (consolidated under Testing in Sprint 24)
- **Maintenance page** — sites query now includes `customer_id` for scope lookup
- **BatchCreateForm** — updated site type to include `customer_id`
- **Contract scope migration** — fixed trigger function name to `set_updated_at()` (matches production)

### Files Created
- `app/(app)/onboarding/OnboardingWizard.tsx`
- `app/(app)/onboarding/actions.ts`
- `components/ui/ExportButton.tsx`
- `lib/utils/csv-export.ts`
- `supabase/migrations/0018_defects.sql`
- `supabase/migrations/0019_onboarding.sql`

### Files Modified
- `app/(app)/layout.tsx` — onboarding wizard integration, mobile padding
- `app/(app)/maintenance/page.tsx` — scope items fetch
- `app/(app)/maintenance/MaintenanceList.tsx` — scopeItems prop passthrough
- `app/(app)/maintenance/CreateCheckForm.tsx` — scope info panel
- `app/(app)/maintenance/BatchCreateForm.tsx` — site type update
- `app/(app)/maintenance/actions.ts` — defect actions
- `app/(app)/assets/AssetList.tsx` — CSV export button
- `app/(app)/sites/SiteList.tsx` — CSV export button
- `app/(app)/customers/CustomerList.tsx` — CSV export button
- `components/ui/Sidebar.tsx` — mobile responsive rewrite
- `lib/types/index.ts` — Defect, ContractScope types
- `lib/actions/notifications.ts` — defect_raised type

---

## [Sprint 24] 2026-04-08 — Customer Logos, Asset Filters, Grouped View, Site Contacts, Contract Scope, Help Widget

### Added
- **Customer logos** — `logo_url` column on customers, displayed in site list customer column with fallback initial avatar
- **Site contacts** — full CRUD for site contacts with primary contact flag, star icon, inline add/edit form (`SiteContacts.tsx`, `contact-actions.ts`)
- **Migration `0016_customer_logos_and_site_contacts.sql`** — customer `logo_url`, `site_contacts` table with RLS
- **DataTable column filters** — `filterable` prop on columns ('text' for search, 'select' for dropdown), client-side filtering built into DataTable
- **Asset grouped view** — collapsible tree layout (Site → Location → Job Plan) with all assets (unpaginated), toggle between table and grouped views
- **Contract scope reference page** (`/contract-scope`) — per-customer, per-FY scope management with included/excluded items, grouped list view
- **Migration `0017_contract_scope.sql`** — `contract_scopes` table with customer/site/FY/scope_item/is_included
- **Help widget** — floating command palette with 15+ help items, search, keyboard shortcut (?), route-change auto-close
- **Consolidated testing menu** — unified `/testing` route with tab navigation (General/ACB/NSX) replacing separate sidebar items
- **AU site map improvements** — proper Australia outline SVG, state borders, calibrated pin positions, pulse animation, legend

### Files Created
- `app/(app)/sites/[id]/SiteContacts.tsx`
- `app/(app)/sites/[id]/contact-actions.ts`
- `app/(app)/contract-scope/page.tsx`
- `app/(app)/contract-scope/ContractScopeList.tsx`
- `app/(app)/contract-scope/actions.ts`
- `app/(app)/testing/layout.tsx`
- `app/(app)/testing/TestingNav.tsx`
- `app/(app)/testing/acb/page.tsx`
- `app/(app)/testing/nsx/page.tsx`
- `app/(app)/assets/AssetGroupedView.tsx`
- `components/ui/HelpWidget.tsx`
- `supabase/migrations/0016_customer_logos_and_site_contacts.sql`
- `supabase/migrations/0017_contract_scope.sql`

---

## [Sprint 23] 2026-04-08 — PM Asset Report, Report Designer & UX Improvements

### Added
- **PM Asset Report DOCX generator** (`lib/reports/pm-asset-report.ts`) — professional per-asset report with cover page, site overview, contents page with internal links, executive summary with KPI grid (pass rates, task breakdown), per-asset sections with colour-coded task checklists, defect/action callouts, confirmation statements, and sign-off page
- **API route** `/api/pm-asset-report?check_id=xxx` — serves the asset report DOCX, fetches check_assets, items, tenant settings, and logo
- **Report Settings page** (`/admin/reports`) — full template editor for report customisation:
  - Section toggles: cover page, site overview, contents, executive summary, sign-off
  - Company details: name, address, ABN, phone (shown on cover page)
  - Custom header/footer text overrides
  - Configurable sign-off fields (add/remove signature lines, e.g. Client Representative)
- **Logo on reports** — tenant logo automatically embedded on report cover page
- **Migration `0015_report_settings.sql`** — adds report config columns to `tenant_settings` (section toggles, company details, header/footer text, sign-off fields JSONB)
- **Complete All Assets button** — on in-progress checks, marks every incomplete task as pass and every check_asset as completed in one action (with confirmation dialog)
- **`completeAllCheckAssetsAction()`** server action — bulk completes all assets in a check
- **AI Strategy document** (`AI_STRATEGY.md`) — phased AI feature roadmap from MVP to advanced
- **Sidebar** — "Report Settings" link under admin section

### Changed
- **Download Report button** — single "Download Report" button on completed checks (removed old Summary Report, now uses asset report only)
- **Report generator** — respects all tenant report settings (conditional sections, dynamic sign-off fields, custom header/footer, logo, company details)
- **`TenantSettings` type** — extended with 12 report config fields

### Fixed
- **Report download not working** — `maximo_asset_id` → `maximo_id` column name fix in API route (Supabase query was silently failing)

### Files Created
- `lib/reports/pm-asset-report.ts`
- `app/api/pm-asset-report/route.ts`
- `app/(app)/admin/reports/page.tsx`
- `app/(app)/admin/reports/ReportSettingsForm.tsx`
- `app/(app)/admin/reports/actions.ts`
- `supabase/migrations/0015_report_settings.sql`
- `AI_STRATEGY.md`

### Files Modified
- `app/(app)/maintenance/[id]/CheckDetailPage.tsx` — download button, complete all assets button
- `app/(app)/maintenance/actions.ts` — new completeAllCheckAssetsAction
- `components/ui/Sidebar.tsx` — report settings link
- `lib/types/index.ts` — TenantSettings report fields
- `lib/tenant/getTenantSettings.ts` — report field defaults

---

## [Sprint 22] 2026-04-08 — Maximo Alignment & Maintenance Check Rebuild (Phase 8)

### Added
- **IBM Maximo data model alignment** — full restructure of maintenance checks to match Maximo PM/WO concepts
- **Migration `0012_job_plan_restructure.sql`** — job plans restructured with `code` and `type` columns, per-item frequency boolean flags (`freq_monthly`, `freq_quarterly`, `freq_semi_annual`, `freq_annual`, `freq_2yr`, `freq_3yr`, `freq_5yr`, `freq_8yr`, `freq_10yr`), `is_dark_site` flag on items
- **Migration `0013_maximo_aligned_schema.sql`** — `job_plan_id` FK and `dark_site_test` on assets, `frequency`/`is_dark_site`/`custom_name`/`start_date`/`maximo_wo_number`/`maximo_pm_number` on maintenance_checks, `check_assets` junction table with RLS, `check_asset_id` on maintenance_check_items
- **Migration `0014_check_assets_work_order.sql`** — `work_order_number` column on `check_assets`
- **Full-page maintenance check detail** (`app/(app)/maintenance/[id]/`) — replaces SlidePanel with dedicated route. Full-width sortable asset table (ID, Name, Location, WO#, Job Plan, Done, Notes). Click any asset row to expand outstanding tasks with Pass/Fail/NA buttons and inline comments
- **Two-path check creation** — Path A: site + frequency auto-finds matching assets by job plan item frequency flags. Path B: paste Maximo asset IDs from customer work order list
- **Auto-naming** — maintenance checks auto-named as "Site - Month - Year" (e.g. "SY2 - April - 2026")
- **Paste WO# from Excel** — bulk paste work order numbers from Excel column, matched to assets in current sort order
- **Force-complete per asset** — marks all job plan items as 'pass' and asset status as 'completed'
- **Preview check assets** — `previewCheckAssetsAction()` shows matching assets before committing to check creation
- **`check_assets` junction table** — links maintenance checks to specific assets with status tracking (pending/completed/na), work_order_number, and notes per asset
- **Frequency-aware task generation** — check items filtered by boolean frequency flags on job_plan_items, not a single frequency enum
- **Dark site test support** — `is_dark_site` flag for items only performed during black start testing
- **`CheckAsset` type** — new TypeScript interface with `work_order_number` field
- **`MaintenanceFrequency` type** — `'monthly' | 'quarterly' | 'semi_annual' | 'annual' | '2yr' | '3yr' | '5yr' | '8yr' | '10yr'`
- **DataTable `onRowClick` prop** — enables clickable rows across all list tables
- **SlidePanel `wide` prop** — `max-w-4xl` when true (retained for other panels)
- **4,802 assets imported** via Supabase REST API with auto-creation of 10 missing sites

### Changed
- **All 9 list components** — removed Pencil/Eye icon action columns; rows are now fully clickable via `onRowClick`
  - CustomerList, AssetList, JobPlanList, SiteList, InstrumentList, TestRecordList, AcbTestList, NsxTestList, MaintenanceList
- **Job Plans list** — removed Site column, Job Code moved to first column
- **Sites list** — removed Code column
- **Asset form** — added job plan dropdown and dark site toggle
- **Asset list** — columns: Maximo ID, Name, Site, Location, Job Plan, Status
- **Maintenance list page** — no longer fetches check_assets/attachments/items for all checks (detail data loads on demand per check)
- **CreateCheckForm** — complete rewrite: site, frequency, dark site toggle, JP filter dropdown, preview, manual mode, start/due dates, owner, Maximo WO/PM numbers
- **Maintenance check validation** — `CreateMaintenanceCheckSchema` now requires site_id, frequency, is_dark_site, start_date, due_date; optional job_plan_id, manual_asset_ids array
- **NotificationBell** — fixed with React portal pattern (dropdown no longer clipped by sidebar overflow)

### Server Actions (New/Rebuilt)
- `previewCheckAssetsAction()` — previews matching assets before creating a check
- `createCheckAction()` — completely rebuilt for Path A/B, auto-naming, check_assets junction, per-asset items filtered by frequency flags, batched inserts (500)
- `forceCompleteCheckAssetAction(checkId, checkAssetId)` — marks all items pass + asset completed
- `bulkUpdateWorkOrdersAction(checkId, updates)` — bulk paste WO numbers
- `updateCheckAssetAction(checkId, checkAssetId, data)` — update notes/WO on a single check_asset

### Files Created
- `app/(app)/maintenance/[id]/page.tsx`
- `app/(app)/maintenance/[id]/CheckDetailPage.tsx`
- `supabase/migrations/0012_job_plan_restructure.sql`
- `supabase/migrations/0013_maximo_aligned_schema.sql`
- `supabase/migrations/0014_check_assets_work_order.sql`

### Files Modified
- `app/(app)/maintenance/{actions,page,MaintenanceList,CreateCheckForm,CheckDetail}.tsx`
- `app/(app)/job-plans/JobPlanList.tsx` — removed site column
- `app/(app)/sites/SiteList.tsx` — removed code column
- `app/(app)/assets/{AssetForm,AssetList,page,actions}.tsx` — job plan + dark site
- `components/ui/{DataTable,SlidePanel,NotificationBell}.tsx`
- `lib/types/index.ts` — CheckAsset, MaintenanceFrequency, updated Asset/MaintenanceCheck/MaintenanceCheckItem
- `lib/validations/{maintenance-check,asset}.ts`
- All 9 `*List.tsx` components — clickable rows

### Verified
- `tsc --noEmit` → 0 non-test TypeScript errors
- Netlify deploy successful (commit `87fc2a5`, production ready)

---

## [Sprint 17] 2026-04-06 — Deploy & Analytics (Phase 5 Complete)

### Added
- **Analytics dashboard** (`app/(app)/analytics/`) — 6 KPI cards (assets, sites, tests, pass rate, compliance, overdue), 12-month test volume stacked bar chart, compliance trend chart with colour thresholds, pass rate by test type breakdown, instrument calibration status. Sidebar link with BarChart3 icon
- **Bulk report export** (`app/api/bulk-report/`) — `GET /api/bulk-report?site_id=xxx`, supervisor+, generates ZIP of all ACB + NSX DOCX reports for a site. `BulkExportButton` component on Reports page with site picker
- **Migration `0010_performance_indexes.sql`** — 24 composite/partial indexes on query hotspots across all entity tables. Applied to `urjhmkhbgaxrofurpbgc`
- **Environment validation** (`lib/env.ts`) — Zod-validated `publicEnv` (URL + anon key) and `serverEnv()` (service role key). Fails fast at startup with descriptive error messages instead of silent `undefined` values
- **`.env.example`** — Template for required environment variables, committed to repo

### Changed
- **Archive/soft-delete UX** — All entity list pages now support `?show_archived=1` toggle. Admin deactivate/reactivate on ACB tests, NSX tests, instruments, test records, assets, customers, sites, job plans
- **Audit event wiring** — `logAuditEvent()` now called in every server action across all modules: assets (create/update/import/toggle), customers (create/update/toggle), sites (create/update/toggle), job plans (create/update/toggle + item CRUD), maintenance (create/update/start/complete/cancel), testing (create/update/toggle), ACB testing (create/update/toggle + readings), NSX testing (create/update/toggle + readings), instruments (create/update/toggle), admin users (invite/activate/role change), admin settings (update)
- **Supabase clients** — `client.ts`, `server.ts`, `admin.ts`, `middleware.ts` now use validated `publicEnv`/`serverEnv()` instead of raw `process.env` with non-null assertions
- **`.gitignore`** — Added `!.env.example` exception so template is tracked
- **Search page** — Fixed TypeScript cast for Supabase foreign key joins on ACB/NSX asset names

### Fixed
- **Missing dependency** — Added `jszip` to `package.json` (was imported but not installed)
- **TypeScript errors** — Resolved `TS2352` cast issues in search page for Supabase join types

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- `next build` blocked only by FUSE sandbox file lock (not code errors)

### Files Created
- `supabase/migrations/0010_performance_indexes.sql`
- `lib/env.ts`
- `.env.example`
- `app/(app)/analytics/{page,AnalyticsCharts}.tsx`
- `app/api/bulk-report/route.ts`
- `components/modules/BulkExportButton.tsx`

### Files Modified
- All `actions.ts` files across `(app)/` modules — audit event wiring
- `lib/supabase/{client,server,admin,middleware}.ts` — env validation
- `app/(app)/search/page.tsx` — TS cast fix
- `.gitignore` — .env.example exception
- `package.json` — jszip dependency
- `ROADMAP.md` — Sprint 17 marked complete
- `CHANGELOG.md` — this entry

---

## [Sprint 15+16] 2026-04-06 — Audit, Search, Instruments, Users (Phase 5)

### Added
- **Migration `0008_audit_logs.sql`** — `audit_logs` table: tenant_id, user_id, action, entity_type, entity_id, summary, metadata (jsonb). Immutable (no update/delete policies). RLS: tenant-scoped read, insert. 5 indexes. Applied to `urjhmkhbgaxrofurpbgc`
- **Migration `0009_instruments.sql`** — `instruments` table: name, instrument_type, make, model, serial_number, asset_tag, calibration_date, calibration_due, calibration_cert, status (Active/Out for Cal/Retired/Lost), assigned_to, notes, is_active. Full RLS. Applied to `urjhmkhbgaxrofurpbgc`
- **Audit log shared action** (`lib/actions/audit.ts`) — `logAuditEvent()` for use in other server actions. Silent failure so audit never blocks mutations
- **Audit log viewer** (`app/(app)/audit-log/`) — Admin-only page with DataTable, filter by entity type + action, colour-coded action badges, pagination, user name resolution
- **Global search** (`app/(app)/search/`) — Searches across assets, sites, customers, ACB tests, NSX tests, instruments. Type-specific icons and badge colours. Full search input with URL-based query params
- **Instrument register** (`app/(app)/instruments/`) — Full CRUD: list with calibration due highlighting (red if overdue), form with calibration section (date, due, cert), status dropdown, assigned_to. Detail panel with calibration info. Admin deactivate
- **TypeScript types** — `AuditLog`, `InstrumentStatus`, `Instrument` added to `lib/types/index.ts`
- **Zod schemas** (`lib/validations/instrument.ts`) — `CreateInstrumentSchema`, `UpdateInstrumentSchema`
- **Sidebar** — Added Instruments (Wrench icon), Search (Search icon), Audit Log (ScrollText icon in Admin section)

### Changed
- **User management** — `requireAdmin()` now accepts `super_admin` role (was admin-only). Self-demotion check updated

### Verified
- `tsc --noEmit` → 0 errors in project code

### Files Created
- `supabase/migrations/0008_audit_logs.sql`, `0009_instruments.sql`
- `lib/actions/audit.ts`
- `lib/validations/instrument.ts`
- `app/(app)/audit-log/{page,AuditLogList}.tsx`
- `app/(app)/search/{page,SearchResults}.tsx`
- `app/(app)/instruments/{page,InstrumentList,InstrumentForm,InstrumentDetail,actions}.tsx`

### Files Modified
- `lib/types/index.ts` — added AuditLog, InstrumentStatus, Instrument
- `components/ui/Sidebar.tsx` — added Instruments, Search, Audit Log links
- `app/(app)/admin/users/actions.ts` — super_admin support in requireAdmin

---

## [Sprint 14] 2026-04-06 — NSX Testing + Reports (Phase 4)

### Added
- **Migration `0007_nsx_tests_schema.sql`** — 2 new tables: `nsx_tests` (asset, site, test_date, tested_by, test_type Initial/Routine/Special, cb_make/model/serial/rating/poles, trip_unit, overall_result Pending/Pass/Fail/Defect, is_active), `nsx_test_readings` (label, value required, unit, is_pass, sort_order). Full RLS: tenant-scoped read, supervisor+ create/edit, admin delete. `updated_at` trigger. 7 indexes. Applied to `urjhmkhbgaxrofurpbgc`
- **TypeScript types** — `NsxTestType`, `NsxTestResult`, `NsxTest`, `NsxTestReading` added to `lib/types/index.ts`
- **Zod schemas** (`lib/validations/nsx-test.ts`) — `CreateNsxTestSchema`, `UpdateNsxTestSchema`, `CreateNsxReadingSchema`, `UpdateNsxReadingSchema`
- **Format helpers** — `formatNsxTestType()`, `formatNsxTestResult()` added to `lib/utils/format.ts`
- **NSX test list page** (`app/(app)/nsx-testing/page.tsx`) — server-side fetch with joined asset/site/tester names. Filter by site + result. Search. Pagination
- **NSX test form** (`NsxTestForm.tsx`) — SlidePanel with asset dropdown (auto-resolves site), test date, tested by, CB make/model/serial/rating/poles, trip unit, test type, overall result, notes
- **NSX test detail** (`NsxTestDetail.tsx`) — read-only view, CB details (6 fields inc. rating, poles, trip unit), readings with inline add/delete, AttachmentList (entity type: `nsx_test`), admin deactivate
- **Server actions** (`actions.ts`) — `createNsxTestAction`, `updateNsxTestAction`, `toggleNsxTestActiveAction`, `createNsxReadingAction`, `deleteNsxReadingAction`
- **NSX DOCX report generator** (`lib/reports/nsx-report.ts`) — per-site NSX/MCCB report: cover page, TOC, per-breaker sections (CB details 16 attributes, visual/functional 16-item checklist, electrical testing tables, trip test results with 4 protection rows). White-label branding
- **NSX report API route** (`app/api/nsx-report/route.ts`) — `GET /api/nsx-report?site_id=xxx`, supervisor+, returns DOCX attachment
- **Generate Report button** on NSX Testing list page — site picker + Report button with blob download
- **Dashboard** — NSX Tests stats row: Total, Passed, Failed, Defects
- **Sidebar** — NSX Testing nav link with `CircuitBoard` icon between ACB Testing and Reports

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- Migration applied successfully to Supabase dev project

### Files Created
- `supabase/migrations/0007_nsx_tests_schema.sql`
- `lib/validations/nsx-test.ts`
- `lib/reports/nsx-report.ts`
- `app/(app)/nsx-testing/{page,NsxTestList,NsxTestForm,NsxTestDetail,actions}.tsx`
- `app/api/nsx-report/route.ts`

### Files Modified
- `lib/types/index.ts` — added `NsxTestType`, `NsxTestResult`, `NsxTest`, `NsxTestReading`
- `lib/utils/format.ts` — added `formatNsxTestType()`, `formatNsxTestResult()`
- `components/ui/Sidebar.tsx` — added NSX Testing nav link with CircuitBoard icon
- `app/(app)/dashboard/page.tsx` — added NSX test stats row

---

## [Sprint 13] 2026-04-06 — ACB Reporting (Phase 4)

### Added
- **ACB DOCX report generator** (`lib/reports/acb-report.ts`) — produces per-site ACB test reports matching the Delta Elcom template structure: cover page (site name, year, generated date, tenant branding), Table of Contents, per-breaker sections (header table, circuit breaker details with 24 attributes, visual/functional quick items + 27-row checklist, electrical testing tables for contact resistance / IR closed / IR open / secondary injection, protection test results). Uses `docx-js` package. White-label: heading colour from tenant primary colour, product name on cover
- **Report download API route** (`app/api/acb-report/route.ts`) — `GET /api/acb-report?site_id=xxx` — auth + role check (supervisor+), fetches all active ACB tests for the site with joined asset data, readings, tester names, tenant settings. Returns DOCX as attachment download
- **Generate Report button** on ACB Testing list page — site picker dropdown + "Report" button. Downloads DOCX via blob URL. Disabled until site selected. Loading state during generation

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- Report template matches uploaded Delta Elcom ACB test report structure

### Files Created
- `lib/reports/acb-report.ts`
- `app/api/acb-report/route.ts`

### Files Modified
- `app/(app)/acb-testing/AcbTestList.tsx` — added Generate Report button with site picker
- `package.json` — added `docx` dependency

### Docs Updated
- `ROADMAP.md` — Sprint 13 ✅
- `ARCHITECTURE.md` — report generator in repo structure, docx dep
- `SPEC.md` — ACB Reports module ✅
- `USER_MANUAL_NOTES.md` — Sprint 13 section: generating ACB reports

---

## [Sprint 12] 2026-04-06 — ACB Test Entry (Phase 4)

### Added
- **Migration `0006_acb_tests_schema.sql`** — 2 new tables: `acb_tests` (asset, site, test_date, tested_by, test_type enum Initial/Routine/Special, cb_make/model/serial, overall_result enum Pending/Pass/Fail/Defect, is_active), `acb_test_readings` (label, value required, unit, is_pass, sort_order). Full RLS: tenant-scoped read, supervisor+ create/edit, admin delete. `updated_at` trigger on acb_tests. 7 indexes. Applied to `urjhmkhbgaxrofurpbgc`
- **TypeScript types** — `AcbTestType`, `AcbTestResult`, `AcbTest`, `AcbTestReading` added to `lib/types/index.ts`
- **Zod schemas** (`lib/validations/acb-test.ts`) — `CreateAcbTestSchema`, `UpdateAcbTestSchema`, `CreateAcbReadingSchema`, `UpdateAcbReadingSchema`
- **Format helpers** — `formatAcbTestType()`, `formatAcbTestResult()` added to `lib/utils/format.ts`
- **ACB test list page** (`app/(app)/acb-testing/page.tsx`) — server-side fetch with joined asset name/type, site name, tester name. Filter by site + result. Search across asset name, CB make, CB model, test type. Pagination. Result badges
- **ACB test form** (`AcbTestForm.tsx`) — SlidePanel with asset dropdown (auto-resolves site), test date, tested by dropdown, CB make/model/serial, test type dropdown, overall result dropdown, notes
- **ACB test detail** (`AcbTestDetail.tsx`) — read-only view with all fields, CB details section, result badge. Readings: inline add form (label, value required, unit, pass/fail), delete per reading. Edit button. Admin deactivate/reactivate. AttachmentList (entity type: `acb_test`)
- **Server actions** (`app/(app)/acb-testing/actions.ts`) — `createAcbTestAction`, `updateAcbTestAction`, `toggleAcbTestActiveAction`, `createAcbReadingAction`, `deleteAcbReadingAction`
- **Dashboard** — ACB Tests stats row: Total, Passed, Failed, Defects. Colour-coded, clickable links to filtered ACB testing view
- **Sidebar** — ACB Testing nav link with `Shield` icon, positioned between Testing and Reports

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- Migration applied successfully to Supabase dev project

### Files Created
- `supabase/migrations/0006_acb_tests_schema.sql`
- `lib/validations/acb-test.ts`
- `app/(app)/acb-testing/{page,AcbTestList,AcbTestForm,AcbTestDetail,actions}.tsx`

### Files Modified
- `lib/types/index.ts` — added `AcbTestType`, `AcbTestResult`, `AcbTest`, `AcbTestReading`
- `lib/utils/format.ts` — added `formatAcbTestType()`, `formatAcbTestResult()`
- `components/ui/Sidebar.tsx` — added ACB Testing nav link with Shield icon
- `app/(app)/dashboard/page.tsx` — added ACB test stats row

### Docs Updated
- `ROADMAP.md` — Sprint 12 ✅, migration 0006 applied, Phase 4 in progress
- `ARCHITECTURE.md` — acb_tests + acb_test_readings in schema table, acb-testing in repo structure
- `SPEC.md` — ACB Test Records module ✅ with full fields and acceptance criteria
- `USER_MANUAL_NOTES.md` — Sprint 12 section: creating ACB tests, adding readings, permissions, dashboard

---

## [Sprints 10+11] 2026-04-06 — CSV Import, File Attachments & Polish (Phase 5)

### Added
- **CSV Asset Import** — full import workflow via SlidePanel: file upload, auto column mapping (fuzzy match), 5-row preview table, site name resolution, validation (required columns, unknown sites, 500-row max). Bulk insert via server action with per-row error reporting. Wired to previously disabled "Import" button on Assets page
- **Migration `0005_attachments_schema.sql`** — `attachments` table (polymorphic: entity_type + entity_id), Supabase Storage `attachments` bucket (private), RLS (tenant-scoped read, supervisor+ upload, admin+ delete), storage policies for tenant-prefixed paths. Applied to `urjhmkhbgaxrofurpbgc`
- **Attachment system** — reusable `AttachmentList` component with upload (10 MB limit, PDF/images/XLSX/DOCX/CSV/TXT), download via signed URL (1hr expiry), delete (admin only). File type icons. Shared server actions: `uploadAttachmentAction`, `deleteAttachmentAction`, `getAttachmentUrlAction`
- **Attachments on Maintenance Checks** — upload/view/delete attachments from CheckDetail panel (supervisor+ or assigned technician can upload)
- **Attachments on Test Records** — upload/view/delete attachments from TestRecordDetail panel (supervisor+ can upload)
- **TypeScript type** — `Attachment` added to `lib/types/index.ts`

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- Migration applied successfully to Supabase dev project

### Files Created
- `supabase/migrations/0005_attachments_schema.sql`
- `lib/actions/attachments.ts` — shared upload/delete/signedUrl server actions
- `components/ui/AttachmentList.tsx` — reusable attachment UI component
- `app/(app)/assets/ImportAssetsModal.tsx` — CSV import modal

### Files Modified
- `lib/types/index.ts` — added `Attachment`
- `app/(app)/assets/actions.ts` — added `importAssetsAction`
- `app/(app)/assets/AssetList.tsx` — wired Import button to ImportAssetsModal
- `app/(app)/maintenance/{page,MaintenanceList,CheckDetail}.tsx` — attachments fetch + prop threading + render
- `app/(app)/testing/{page,TestRecordList,TestRecordDetail}.tsx` — attachments fetch + prop threading + render

---

## [Sprints 8+9] 2026-04-06 — Testing Module & Compliance Reports (Phase 4)

### Added
- **Migration `0004_test_records_schema.sql`** — 2 new tables: `test_records`, `test_record_readings`. Full RLS with tenant scoping, supervisor+ write, admin delete. Indexes on tenant, asset, site, result, dates. Applied to `urjhmkhbgaxrofurpbgc` via Supabase MCP
- **TypeScript types** — `TestResult`, `TestRecord`, `TestRecordReading` added to `lib/types/index.ts`
- **Zod schemas** (`lib/validations/test-record.ts`) — `CreateTestRecordSchema`, `UpdateTestRecordSchema`, `CreateTestReadingSchema`, `UpdateTestReadingSchema`
- **Format helper** — `formatTestResult()` added to `lib/utils/format.ts`
- **Test records list page** — replaced placeholder. Server-side fetch with joined asset name/type, site name, tester name. Filter by site + result. Search across asset name, site, test type. Pagination
- **Test record form** (`TestRecordForm.tsx`) — SlidePanel with asset dropdown (auto-resolves site), test type, test date, tested by dropdown, result (pending/pass/fail/defect), next test due, notes
- **Test record detail** (`TestRecordDetail.tsx`) — read-only view with all fields, result badge, readings section. Inline "Add Reading" form (label, value, unit, pass/fail). Delete readings. Edit button opens form. Admin deactivate/reactivate
- **Readings management** — inline add/delete within detail panel. Fields: label, value, unit, pass/fail boolean. Sort order auto-assigned
- **Server actions** — `createTestRecordAction`, `updateTestRecordAction`, `toggleTestRecordActiveAction`, `createReadingAction`, `deleteReadingAction`
- **Compliance Reports page** — replaced placeholder. Site filter + date range (from/to). Four KPI cards: Maintenance Compliance %, Overdue Checks, Test Pass Rate %, Test Defects count. Colour-coded thresholds (green ≥80%, amber ≥50%, red <50%)
- **Report breakdowns** — horizontal bar charts for maintenance status distribution and test result distribution
- **Overdue by site** — top 5 sites with most overdue maintenance checks
- **Recent failed tests** — last 10 failed/defect tests with asset name, test type, date, result badge
- **Dashboard** — added Test Records stats row: Total Tests, Passed, Failed, Defects. Colour-coded, clickable links to filtered testing view
- **StatusBadge** — added optional `label` prop for custom display text (used by test result badges)

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- Migration applied successfully to Supabase dev project

### Files Created
- `supabase/migrations/0004_test_records_schema.sql`
- `lib/validations/test-record.ts`
- `app/(app)/testing/{TestRecordList,TestRecordForm,TestRecordDetail,actions}.tsx`
- `app/(app)/reports/ReportFilters.tsx`

### Files Modified
- `lib/types/index.ts` — added `TestResult`, `TestRecord`, `TestRecordReading`
- `lib/utils/format.ts` — added `formatTestResult()`
- `components/ui/StatusBadge.tsx` — added optional `label` prop
- `app/(app)/testing/page.tsx` — full CRUD replacing placeholder
- `app/(app)/reports/page.tsx` — compliance dashboard replacing placeholder
- `app/(app)/dashboard/page.tsx` — added test records stats row

---

## [Sprint 7] 2026-04-06 — Maintenance Checks (Phase 3)

### Added
- **Migration `0003_maintenance_checks_schema.sql`** — 2 new tables: `maintenance_checks`, `maintenance_check_items`. Full RLS with tenant scoping, role-based access (supervisor+ create, technician can update assigned checks), `updated_at` triggers, 8 indexes. Applied to `urjhmkhbgaxrofurpbgc` via Supabase MCP.
- **TypeScript types** — `MaintenanceCheck`, `MaintenanceCheckItem`, `CheckStatus`, `CheckItemResult` added to `lib/types/index.ts`
- **Zod schemas** (`lib/validations/maintenance-check.ts`) — `CreateMaintenanceCheckSchema`, `UpdateMaintenanceCheckSchema`, `UpdateCheckItemResultSchema`
- **Format helpers** — `formatCheckStatus()`, `formatCheckItemResult()` added to `lib/utils/format.ts`
- **Maintenance list page** — replaced placeholder. Server-side fetch with joined job plan name, site name, assignee name, item counts. Filter by site + status. Pagination. Search across job plan and site names
- **Create check form** — SlidePanel with job plan dropdown (shows site + frequency), due date, assignee dropdown (all active tenant members), notes. On submit: copies all job_plan_items into maintenance_check_items
- **Check detail panel** — read-only header (site, due date, assignee, status, progress count). Action buttons: Start Check, Complete Check (validates required items), Cancel Check (admin only)
- **Technician workflow** — check items display with pass/fail/na toggle buttons (green checkmark, red X, grey dash). Inline notes per item. Items only editable when check is `in_progress`. Required items flagged. Complete blocked until all required items have results
- **Server actions** — `createCheckAction` (copies plan items), `updateCheckAction`, `startCheckAction`, `completeCheckAction` (validates required items), `cancelCheckAction` (admin only), `updateCheckItemAction` (result + notes with completed_at/completed_by tracking)
- **Dashboard** — expanded with maintenance stats row: Scheduled, In Progress, Overdue, Complete counts. Colour-coded (blue, amber, green). Clickable links to filtered maintenance view

### Schema Design Decisions
- **Template → Instance pattern**: Job plans are templates, maintenance_checks are instances. Items are copied at check creation so the plan can change without affecting in-progress checks
- **Technician self-service**: assigned technicians can start/complete their own checks and update item results without supervisor intervention
- **Result tracking**: pass/fail/na per item with `completed_at` + `completed_by` audit trail
- **Soft status workflow**: scheduled → in_progress → complete (or overdue/cancelled). No hard deletes — admin can cancel

### Verified
- `tsc --noEmit` → 0 TypeScript errors
- Migration applied successfully to Supabase dev project

### Files Created
- `supabase/migrations/0003_maintenance_checks_schema.sql`
- `lib/validations/maintenance-check.ts`
- `app/(app)/maintenance/{actions,CreateCheckForm,CheckDetail,MaintenanceList}.tsx`

### Files Modified
- `lib/types/index.ts` — added `CheckStatus`, `CheckItemResult`, `MaintenanceCheck`, `MaintenanceCheckItem`
- `lib/utils/format.ts` — added `formatCheckStatus()`, `formatCheckItemResult()`
- `app/(app)/maintenance/page.tsx` — full CRUD replacing placeholder
- `app/(app)/dashboard/page.tsx` — added maintenance stats row

---

## [Sprint 4] 2026-04-06 — Customers & Sites CRUD UI

### Added
- **Customers list page** (`app/(app)/customers/page.tsx`) — server-side data fetching, search (name/code/email), pagination (25/page), DataTable with status badges, SlidePanel create/edit forms, deactivate/reactivate (admin+)
- **Customer form** (`CustomerForm.tsx`) — name, code, email, phone, address fields. Edit mode shows "Sites" quick-link to filtered sites view
- **Sites list page** — replaced placeholder. Server-side fetch with joined customer name and asset count column. Customer dropdown filter, search, pagination. Clickable asset count navigates to `/assets?site_id=xxx`
- **Site form** (`SiteForm.tsx`) — name, code, customer dropdown, address, city, state, postcode, country (default Australia). Deactivate/reactivate for admin+
- **Customers nav item** — added to Sidebar between Dashboard and Sites, using `Building2` icon
- **Dashboard** — replaced hardcoded stats with live counts (customers, sites, assets, job plans) fetched from Supabase. Clickable cards link to respective list pages
- **Server actions** for customers and sites — `createCustomerAction`, `updateCustomerAction`, `toggleCustomerActiveAction`, `createSiteAction`, `updateSiteAction`, `toggleSiteActiveAction`

### Verified
- `npx next build` → 26 routes compiled, 0 TypeScript errors
- Seed data renders correctly (Equinix, Schneider customers; SY1, SY4, MEL1 sites)

---

## [Sprint 5] 2026-04-06 — Asset Register UI

### Added
- **Assets list page** — replaced placeholder. Server-side fetch with joined site name. Filter bar: site dropdown + asset type dropdown + search (name/type/serial/maximo). Pagination
- **Asset type filter** — dynamically fetches distinct `asset_type` values from the assets table
- **Asset form** (`AssetForm.tsx`) — grouped sections (Identification, Location, Details). Site dropdown (required), date picker for install date. Admin section for deactivate/reactivate
- **Asset detail view** — read-only detail panel with all fields displayed, "Edit" button to switch to form mode, "Job Plans" section showing plans linked to the asset's site
- **Import placeholder** — disabled "Import" button with "Coming soon — CSV import" tooltip
- **Server actions** — `createAssetAction` (supervisor+), `updateAssetAction` (supervisor+), `toggleAssetActiveAction` (admin+)

---

## [Sprint 6] 2026-04-06 — Job Plans UI & Tenant Settings

### Added
- **Job Plans list page** (`app/(app)/job-plans/page.tsx`) — server-side fetch with joined site name and item count. Filter bar: site dropdown + frequency dropdown + search. Pagination
- **Job Plan form** (`JobPlanForm.tsx`) — name, site dropdown, description textarea, frequency dropdown (Weekly/Monthly/Quarterly/Bi-annual/Annual/Ad Hoc). Deactivate/reactivate for admin+
- **Job Plan Items** — inline task management below job plan form. Add/edit/delete individual items with description, sort order, required flag. Hard delete for items
- **Job Plans nav item** — added to Sidebar between Assets and Maintenance, using `FileCheck` icon
- **Tenant Settings editor** — replaced placeholder with full editing form. Branding section: product name, 4 colour pickers with live hex display and preview strip. Contact section: support email. Logo URL input (file upload deferred). Saves via server action, updates CSS vars on next page load
- **Format helpers** (`lib/utils/format.ts`) — `formatFrequency()`, `formatDate()` (DD MMM YYYY), `formatDateTime()` (DD MMM YYYY, HH:mm)
- **Role utilities** (`lib/utils/roles.ts`) — `isAdmin()`, `canWrite()`, `isSuperAdmin()` extracted from server action context
- **Server action auth** (`lib/actions/auth.ts`) — `requireUser()` resolves authenticated user + tenant + role for server actions

### Shared Components Added
- **Pagination** (`components/ui/Pagination.tsx`) — Page X of Y with Previous/Next, URL-based via searchParams
- **SearchFilter** (`components/ui/SearchFilter.tsx`) — reusable search input + dropdown filters, URL-based
- **StatusBadge** extended with `active`/`inactive` variants (green/grey)

### Fixed
- **Zod error access** — changed `.error.errors[0]` to `.error.issues[0]` across all server actions (correct Zod v3 API)

### Files Created
- `app/(app)/customers/{page,CustomerList,CustomerForm,actions}.tsx`
- `app/(app)/sites/{SiteList,SiteForm,actions}.tsx`
- `app/(app)/assets/{AssetList,AssetForm,actions}.tsx`
- `app/(app)/job-plans/{page,JobPlanList,JobPlanForm,actions}.tsx`
- `app/(app)/admin/settings/{TenantSettingsForm,actions}.tsx`
- `lib/actions/auth.ts`, `lib/utils/roles.ts`, `lib/utils/format.ts`
- `components/ui/{Pagination,SearchFilter}.tsx`

### Files Modified
- `components/ui/Sidebar.tsx` — added Customers + Job Plans nav items
- `components/ui/StatusBadge.tsx` — added active/inactive variants
- `app/(app)/dashboard/page.tsx` — live counts from Supabase
- `app/(app)/sites/page.tsx` — full CRUD replacing placeholder
- `app/(app)/assets/page.tsx` — full CRUD replacing placeholder
- `app/(app)/admin/settings/page.tsx` — full editor replacing placeholder

---

## [Sprint 3] 2026-04-06 — Core Schema, API Layer, White-Label Engine, Expanded Roles

### Added
- **Migration `0002_core_schema.sql`** — 8 new tables: `tenants`, `tenant_settings`, `tenant_members`, `customers`, `sites`, `assets`, `job_plans`, `job_plan_items`. Full RLS on every table, `updated_at` triggers, indexes.
- **Helper functions**: `get_user_tenant_ids()`, `is_super_admin()`, `get_user_role(tenant_id)`, `is_tenant_admin(tenant_id)` — all SECURITY DEFINER with explicit search_path.
- **Expanded roles**: profiles constraint updated to support `super_admin`, `admin`, `supervisor`, `technician`, `read_only`, `user`. Invite form and users table updated with all 5 roles.
- **TypeScript types** (`lib/types/index.ts`): `Tenant`, `TenantSettings`, `TenantMember`, `Profile`, `Customer`, `Site`, `Asset`, `JobPlan`, `JobPlanItem`, `ApiResponse<T>`, `PaginationMeta`, `Role`, `Frequency`.
- **Zod validation schemas** (`lib/validations/`): `tenant.ts`, `customer.ts`, `site.ts`, `asset.ts`, `job-plan.ts` — create + update schemas for all entities.
- **API helpers** (`lib/api/`): `response.ts` (ok, created, err, unauthorized, forbidden, notFound), `pagination.ts` (parsePagination, paginationMeta), `auth.ts` (getApiUser, isAdmin, canWrite, isSuperAdmin).
- **CRUD API routes**: tenants (super_admin only), customers, sites (filter by customer_id), assets (filter by site_id), job-plans (filter by site_id), job-plan-items — all with Zod validation, pagination, role-based access, soft deletes. 12 route files total.
- **White-label engine**: `lib/tenant/getTenantSettings.ts` resolves tenant settings for current user. `app/(app)/layout.tsx` injects `--eq-sky`, `--eq-deep`, `--eq-ice`, `--eq-ink` CSS vars from `tenant_settings` — changing colours in DB changes the app without redeploy. `TenantLogo` component renders logo image or text fallback.
- **Sidebar**: now uses `TenantLogo` + `product_name` from tenant settings. Added "Tenant Settings" admin link.
- **Auth layout**: uses `TenantLogo` component for branded auth screens.
- **`/admin/settings`**: placeholder page showing current tenant settings (colours, product name, logo status). Editing deferred to Sprint 4.
- **Seed data**: SKS Technologies tenant with settings, 2 customers (Equinix, Schneider), 3 sites (SY1, SY4, MEL1), 5 assets (ACB, NSX, Switchboard, ATS), 1 job plan with 3 items. Both existing admin users linked as `super_admin`.
- **Installed**: `zod` for schema validation.

### Verified
- `npx next build` → 31 routes compiled, 0 TypeScript errors
- Migration applied to `urjhmkhbgaxrofurpbgc`, security advisors clean
- Seed data visible in Supabase dashboard

### Decisions Made
- **Tables before functions** in migration — Postgres requires referenced tables to exist when creating SECURITY DEFINER functions with inline SQL.
- **Tenant resolution**: single-tenant per user for now (first active `tenant_members` row). Multi-tenant user support (switching tenants) deferred.
- **Admin route guard**: updated to check `tenant_members.role` for `super_admin` or `admin`, replacing `profiles.role` check.
- **Soft deletes via `is_active`**: consistent across all entities, per TECH_SPEC.
- **Pagination**: default 25/page, max 100, using Supabase `.range()`.

### Files Touched
- Created: `supabase/migrations/0002_core_schema.sql`, `lib/types/index.ts` (rewritten), `lib/api/{response,pagination,auth}.ts`, `lib/validations/{tenant,customer,site,asset,job-plan}.ts`, `lib/tenant/getTenantSettings.ts`, `components/ui/TenantLogo.tsx`, `app/api/{tenants,customers,sites,assets,job-plans}/**/*.ts` (12 route files), `app/(app)/admin/settings/page.tsx`
- Modified: `app/(app)/layout.tsx` (tenant CSS vars + settings prop), `app/(auth)/layout.tsx` (TenantLogo), `components/ui/Sidebar.tsx` (TenantLogo, settings prop, admin settings link, expanded roles), `app/(app)/admin/users/{InviteUserForm,UsersTable,actions}.tsx` (5 roles)
- Installed: `zod`

---

## [Sprint 2] 2026-04-05 — Auth, MFA & User Management

### Added
- DB migration `0001_profiles_and_recovery_codes.sql` — `profiles` table (role-based: admin/user, is_active soft-delete, last_login_at), `mfa_recovery_codes` table, `handle_new_user()` trigger (auto-creates profile, seeds admin role for `dev@eq.solutions`), `is_admin()` SECURITY DEFINER helper, `set_updated_at()` trigger, full RLS policies (users see/update own, admins see/update all, users cannot change their own role)
- `lib/supabase/admin.ts` — service-role client for server-only admin operations (invites, recovery code writes)
- `lib/supabase/middleware.ts` — `updateSession()` helper that refreshes cookies and returns user + AAL level
- `proxy.ts` (Next 16 — replaces middleware.ts) — session refresh on every request, AAL1→AAL2 enforcement, admin route guard, deactivated-user signout, auto-redirect authed users away from public auth pages
- `/auth/signin` — email+password form via server action, updates `last_login_at` on success
- `/auth/forgot-password` + `/auth/reset-password` — Supabase email reset flow
- `/auth/callback` — exchanges reset/invite email codes for session
- `/auth/enroll-mfa` — TOTP QR code (Google/Microsoft Authenticator), verify, generates 8 bcrypt-hashed recovery codes (`XXXXX-XXXXX` format) shown once with download option
- `/auth/mfa` — challenge page with TOTP 6-digit code + recovery-code fallback (consumes code, unenrols factor, forces re-enrolment)
- `/auth/signout` — POST/GET route, wired from sidebar
- `/admin/users` — admin-only page: list all users, invite by email (sends Supabase invite with `reset-password` redirect, assigns role), toggle active, change role (cannot self-deactivate or self-demote)
- Sidebar: admin section with Users link (only when `isAdmin`), active-route highlighting, signout button at bottom, converted to `next/link`

### Removed
- Old `/app/(auth)/login/page.tsx` placeholder

### Verified
- `npx next build` passes — 19 routes, 0 TypeScript errors, proxy compiled
- Migration applied to project `urjhmkhbgaxrofurpbgc`, security advisors clean (search_path fixed on `set_updated_at`)

### Decisions Made
- **`proxy.ts` (not `middleware.ts`)** — Next.js 16 renamed middleware to proxy with `proxy()` export. Idiomatic v16 pattern, not flagged as a deviation.
- **Custom recovery codes** — Supabase has no built-in recovery code API for TOTP; implemented bcrypt-hashed storage in `mfa_recovery_codes` with RLS (users read own, service-role writes).
- **Service role for admin ops** — user invites, recovery code inserts, and admin user mutations go via `createAdminClient()` to bypass RLS. Key is server-side only.
- **Admin bootstrap** — `handle_new_user()` trigger seeds admin role for emails in hardcoded array (`dev@eq.solutions`). First admin is created by signing up with that email.
- Password minimum length: 10 chars (on reset).

### Fixed During Testing (same session)
- **QR code rendering** — Supabase returns `totp.qr_code` as a `data:image/svg+xml` data URL, not raw SVG. Changed `dangerouslySetInnerHTML` to `<img src={qrCode}>` so authenticator apps can scan it.
- **Stale MFA factor hang** — `enrollStartAction()` failed silently if an unverified factor existed from a previous aborted enrolment. Now cleans up unverified factors before enrolling + catches errors in client.
- **Password reset AAL2 block** — Supabase blocks `updateUser({password})` at AAL1 when MFA is enrolled. Recovery email only grants AAL1. Fixed by using `admin.auth.admin.updateUserById()` (service-role) — email ownership already proven by recovery link. Signs user out after update.
- **Forgot-password redirect path** — `redirectTo` was pointing directly at `/auth/reset-password`, skipping code exchange. Changed to `/auth/callback?next=/auth/reset-password` so the callback handler exchanges the code first.
- **AAL-exempt paths** — `proxy.ts` was forcing MFA challenge before `/auth/reset-password` and `/auth/signout`. Added `AAL_EXEMPT_PATHS` array to allow these without AAL2.
- **Resend SMTP configured** — Supabase default SMTP rate-limited at 2 emails/hour. Custom SMTP (Resend) configured in Supabase dashboard. Invite emails now deliver.

### Blocked / Flagged for Chat
- **MFA is enforced on all app routes.** Any authenticated user without a TOTP factor is forced to `/auth/enroll-mfa` before accessing any page. If you need to bypass this temporarily for dev/testing, flag to Chat.
- **Roles currently limited to `admin` and `user`.** TECH_SPEC defines Supervisor, Technician, Read-Only, and Super Admin — these need to be added in a future sprint when the corresponding features require them.

### Files Touched
- Created: `supabase/migrations/0001_profiles_and_recovery_codes.sql`, `lib/supabase/admin.ts`, `lib/supabase/middleware.ts`, `proxy.ts`, `app/(auth)/auth/{signin,forgot-password,reset-password,enroll-mfa,mfa,callback}/*`, `app/auth/signout/route.ts`, `app/(app)/admin/users/{page,actions,InviteUserForm,UsersTable}.tsx`
- Modified: `components/ui/Sidebar.tsx` (admin link, signout, active state), `app/(app)/layout.tsx` (fetches isAdmin), `app/(auth)/layout.tsx` (EQ branded auth shell)
- Removed: `app/(auth)/login/page.tsx`
- Installed: `bcryptjs@^3.0.3`

---

## [Sprint 1] 2026-04-05 — Next.js scaffold and EQ design system

### Added
- Next.js 16 App Router project with TypeScript strict mode and Tailwind CSS v4
- EQ design tokens (eq-sky, eq-deep, eq-ice, eq-ink, eq-grey) exposed via Tailwind v4 `@theme` directive in `app/globals.css`
- Plus Jakarta Sans typography via Google Fonts
- Supabase browser and server clients (`lib/supabase/client.ts`, `lib/supabase/server.ts`) using `@supabase/ssr`
- `cn()` utility (`lib/utils/cn.ts`)
- UI components: Button, Card, StatusBadge, FormInput, DataTable, Modal, SlidePanel, Sidebar, Breadcrumb
- App group layout with collapsible sidebar (`app/(app)/layout.tsx`)
- Dashboard placeholder with stat cards and status badge (`app/(app)/dashboard/page.tsx`)
- Placeholder pages: sites, assets, maintenance, testing, reports, settings, login
- Root redirect `/` → `/dashboard` (`app/page.tsx`)
- Health check API endpoint `GET /api/health` with Supabase connection test
- Full folder structure per TECH_SPEC.md (`app/(auth)`, `app/(app)`, `app/api`, `components/ui`, `components/modules`, `lib/supabase`, `lib/validations`, `lib/utils`, `lib/types`, `supabase/migrations`, `supabase/seed`)

### Verified
- `npm run build` passes — all 11 routes compile, 0 TypeScript errors
- Dev server runs — `/` returns 307 → `/dashboard`, `/dashboard` returns 200 with EQ design tokens rendered, `/api/health` returns `{"status":"ok","supabase":"connected (no tables yet)",...}` confirming Supabase credentials in `.env.local` work

### Decisions Made
- **Tailwind v4 used (deviation from prompt, within spec):** `create-next-app` installed Tailwind v4 (latest stable, per TECH_SPEC.md §Stack). V4 uses CSS-first config via `@theme` directive in `globals.css` — there is no `tailwind.config.ts` file. EQ tokens work identically (`bg-eq-sky`, `text-eq-ink`, etc.). Flag to Chat if v3 pinning is required.
- **Next.js 16 installed (not 14):** latest stable via `create-next-app@latest`. App Router behaviour unchanged from 14.
- Sidebar collapses to icon-only mode on toggle (per prompt).

### Blocked / Flagged for Chat
- **Not yet committed/pushed.** Step 14 (`git add . && git commit && git push origin main`) deferred to Royce to execute locally — Cowork does not push to production/remote without explicit per-session instruction per brief §8. Suggested commit message: `feat: scaffold Next.js project with EQ design system and Supabase connection`
- `SPRINT_1_COWORK_PROMPT.md` and `eq-solves-release-v1.5.zip` present in repo root — recommend `.gitignore`-ing or moving to a `docs/` folder before committing.

### Files Touched
- Created: `app/globals.css` (replaced), `app/layout.tsx` (replaced), `app/page.tsx` (replaced), `app/(app)/layout.tsx`, `app/(app)/{dashboard,sites,assets,maintenance,testing,reports,settings}/page.tsx`, `app/(auth)/login/page.tsx`, `app/api/health/route.ts`, `components/ui/{Button,Card,StatusBadge,FormInput,DataTable,Modal,SlidePanel,Sidebar,Breadcrumb}.tsx`, `lib/supabase/{client,server}.ts`, `lib/utils/cn.ts`, `lib/types/index.ts`, `CHANGELOG.md`
- Installed: `@supabase/supabase-js`, `@supabase/ssr`, `lucide-react`, `clsx`, `tailwind-merge`
