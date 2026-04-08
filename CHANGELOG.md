# CHANGELOG — EQ Solves Service

All notable changes to this project are logged here. Appended by Cowork at the end of every session.

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
