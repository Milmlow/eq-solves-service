# EQ Service — module reference

Per-module specs (routes, workflows, toolbars, report formats). **Read the relevant
section before working on a module.** Moved out of `CLAUDE.md` (2026-06-03) so the
always-loaded contract stays lean — this is load-on-demand reference, not behavioural
rules. The maintenance-checks data model + RLS rules stay in `CLAUDE.md` (load-bearing).

## Testing tab navigation (post 2026-04-28)

**Sidebar entry removed.** "Testing" is no longer in the sidebar (PR #38). All test work lives under `/maintenance` — open a check, see linked tests in the panel, click through. The `/testing/*` routes still resolve for direct URLs and deep links, but they're not a top-level destination.

Page-level routes:
- `/testing/summary` — combined register, kept for ad-hoc "show me all test-bench checks" via direct URL.
- `/testing/acb` — site selector → asset list → in-page 3-step workflow. Toolbar: Import / Export / Breaker Details / Create Check.
- `/testing/nsx` — same shape. Toolbar: Create Check only.
- `/testing/rcd` — list view. Toolbar: Import xlsx.

Test-id deep links (used by the Linked Tests panel on `/maintenance/[id]`): `/testing/acb/[testId]`, `/testing/nsx/[testId]`, `/testing/rcd/[id]`.

**Sticky Create Check button** on `/testing/{acb,nsx}` Create Check views — pinned to top so it stays visible while scrolling 100-row asset lists.

Legacy URLs `/acb-testing` and `/nsx-testing` 308-redirect to `/testing/{acb,nsx}` via `next.config.ts` (config-only; old route folders removed, their `actions.ts` now lives at `/testing/{acb,nsx}/actions.ts`).

## ACB Testing Module

3-step workflow for Air Circuit Breakers at `/testing/acb`:
1. **Asset Collection** (Step 1) — breaker identification (brand, type, name/location, serial, performance level N1/H1/H2/H3/L1, protection unit Y/N), trip unit & ratings (model, poles, IN, fixed/withdrawable), protection settings (conditional on protection unit, long time Ir/tr, short time Isd/tsd, instantaneous, earth fault, earth leakage), accessories (motor charge, MX1, XF, MN, MX2 — voltage dropdowns)
2. **Visual & Functional** (Step 2) — 23-item inspection across 5 sections: Visual Inspection (4), Service Operations (3), Functional Tests Chassis (3 incl numeric op counter), Functional Tests Device (11), Auxiliaries (2). Each item OK/Not OK/N/A with comment on failure.
3. **Electrical Testing** (Step 3) — contact resistance R/W/B in µΩ with 30% variance warning, IR closed (7 combos in MΩ), IR open (4 in MΩ), temperature °C, secondary injection check, maintenance completion (greasing, op counter, racking)

Assets filtered by E1.25 job plan (global plan — `name='E1.25'` OR `code='LVACB'`, `site_id` is null). Default tab is Visual & Functional (Step 2). Excel batch fill: export pre-populated .xlsx per site, fill offline, import back to batch-update. Site-level Asset Collection view: expandable cards per CB. Toolbar (l→r): Import, Export, Breaker Details, Create Check (manual asset picker → one ACB test record per selected asset).

## NSX Testing Module

3-step workflow at `/testing/nsx` mirroring ACB. Site-based asset loading filtered by NSX / MCCB job plan (name containing 'NSX' or code `LVNSX`/`MCCB`), falls back to all site assets if no matching plan. Step 1 full collection form; Step 2 the 23-item inspection matching ACB; Step 3 electrical testing same shape as ACB. State via `step1/2/3_status` columns on `nsx_tests` (migration 0026). Toolbar mirrors ACB.

## Testing Summary

`/testing/summary` — combined register of ACB, NSX and General test-bench checks with site / kind / status / date filters, KPI cards and progress bars. Default landing page for `/testing` (redirects). Queries `maintenance_checks` directly filtered by `.in('kind', ['acb','nsx','general'])`.

## Reports

`/reports` — compliance dashboard: maintenance compliance rate, overdue checks, test pass rate, ACB & NSX workflow progress, defects register summary (status + severity), maintenance compliance by site (top 10), 6-month trend chart.

**Customer Report on `/maintenance/[id]`** — "Customer Report" button calls `/api/pm-asset-report` → customer-facing docx. Bundles a **Test Records** section with per-asset summary tables for any linked ACB / NSX / RCD tests (one button = one PDF reflecting the whole visit). Renders nothing extra when no tests are linked. Cover: tenant logo only, 56pt headline.

**Field Run-Sheet on `/maintenance/[id]`** — "Field Run-Sheet" SplitButton + "Print Blank for Onsite" both call `/api/maintenance-checklist`. **Kind-aware**:
- `kind=maintenance` (PPM): one card per `check_asset` with its `maintenance_check_items` as task rows.
- `kind=acb`/`nsx`: one card per linked test with a 5-row task list (brand/model/serial · visual & functional · electrical readings · overall result · notes).
- `kind=rcd`: one card per board with one row per circuit (section · circuit no · trip rating · blank X1/X5 timing · button-test checkbox).
- Brand strip uses `adjustHex(primaryColour, -0.20)` to auto-darken the tenant primary (SKS `#7C77B9` → deep purple), not the navy `deep_colour` override.

Three run-sheet formats: `format=simple` (master register only, 1-page supervisor hand-out), `format=standard` (default — master register page + per-asset detail cards), `format=detailed` (per-asset cards only). Cover always on its own page (`PageBreak()`).

**Linked Tests panel on `/maintenance/[id]`** — server component `LinkedTestsPanel.tsx`; click-through to `/testing/{kind}/[testId]`. Layout order: header → linked tests → attachments → asset table.

Smoke tests for visual review: run-sheet at `tests/lib/reports/maintenance-checklist.smoke.test.ts`; Customer Report at `pm-asset-report.smoke.test.ts` (+ `pm-asset-report-with-tests.smoke.test.ts` for the Test Records / RCD / ACB-NSX deep detail). Output docx files land in `tmp/smoke/`.

### Report Settings (`/admin/reports`)
Configurable report template — section toggles (cover, overview, contents, summary, sign-off), company details, header/footer text, sign-off fields, plus:
- **Report complexity**: summary / standard / detailed — controls per-asset detail level
- **Logo URL**: custom report logo (falls back to tenant logo)
- **Customer logo toggle** + **Site photos toggle** on cover
- DB columns: migration `0031_report_settings_expansion`

## Job Plans
Three scope tiers (shown in the **Scope** column on `/job-plans`):
- **Site-scoped** — `site_id` set, one site only.
- **Customer-scoped** — `customer_id` set + `site_id` null, all sites of that customer (e.g. JEMENA-SWB-MAINT). Migration 0066.
- **Global** — both null, available everywhere in the tenant (all 47 SKS Equinix/Maximo plans are global).

Columns: code (Job Code), name (Job Plan e.g. E1.25), type (descriptive Name). Assets link via `assets.job_plan_id` → `job_plans.id` (1:1 primary; checks can be created against other plans too). Toolbar: Items Register, Import, Export, Add Job Plan. Filters: search, customer, site.

## Contract Scope
`/contract-scope` — included/excluded scope items per customer per FY, grouped by customer with counts. Toolbar: Import, Export, Add Scope Item. Import matches customer/site by name lookup.

## Calendar
`/calendar` — PM calendar with list, calendar (Jan–Dec), and quarterly views. Show Archived toggle. Month ordering Jan→Dec.

## Assets Page
Filterable by customer, site, job plan (dropdown shows `name - type`). Grouped + table view with site-based grouping. Customer filter resolves to the customer's sites (through `sites.customer_id`); same logic in the page query and the `get_assets_for_grouping` RPC (migration 0067).

## Maintenance Import (Delta / Maximo)
`/maintenance/import` — wizard for the monthly Equinix Delta WO export (`.xlsx`).
- **Multiple files in one pass** — stage list per file with parse status + remove; per-file preview/commit sequential with a combined preview.
- **Consolidate toggle** — ≥2 files for the same site merge into ONE `maintenance_check` (`job_plan_id=NULL`, user-supplied `custom_name`); each `check_asset` still derives `check_items` from its own job plan.
- **Locked behaviours:** consolidated frequency = most common across groups (ties → earliest); same WO# across files = hard error before any write; mixed-site upload disables consolidate.
- Server actions: `commitDeltaImportAction` (single) and `commitConsolidatedDeltaImportAction` (multi→1). Wizard branches on the toggle.
