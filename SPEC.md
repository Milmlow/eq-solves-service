# EQ Solves — Product Specification

> Feature spec in testable form. Maps to UAT, user manual, and handoff documentation.
> Last updated: Sprint 22 complete — 08 Apr 2026.

---

## Product Overview

**EQ Solves** is a white-label, multi-tenant SaaS platform for managing electrical assets, preventative maintenance, and compliance testing at industrial and data centre sites.

Built by EQ Solutions (CDC Solutions Pty Ltd). First commercial customer: SKS Technologies.

---

## Platform

### Multi-Tenancy
- Complete data isolation between tenants via PostgreSQL RLS
- Tenants configure: product name, logo, brand colours (primary, secondary, accent, text)
- Branding applies at login — no redeploy required
- Tenant A cannot see any data belonging to Tenant B

### Authentication
- Email + password login (invite-only — no self-registration)
- Mandatory TOTP MFA (Google/Microsoft Authenticator)
- 8 single-use recovery codes generated at MFA enrolment (shown once, downloadable)
- Password reset via email link
- Automatic session refresh

### Roles

| Role | Capabilities |
|------|-------------|
| Super Admin | Cross-tenant platform access |
| Admin | Full tenant access — all CRUD, user management, settings, deactivation |
| Supervisor | Create/manage all operational records — checks, tests, assets |
| Technician | Execute assigned maintenance checks, update item results |
| Read Only | View all records, no writes |

---

## Modules (Built)

### Dashboard
- Live counts: customers, sites, assets, job plans (all clickable)
- Maintenance stats: Scheduled / In Progress / Overdue / Complete
- Test stats: Total / Passed / Failed / Defects
- ACB Test stats: Total / Passed / Failed / Defects
- All stats colour-coded and link to filtered list views

### Customers
- Full CRUD (admin/supervisor create; admin deactivate)
- Fields: name, code, ABN, email, phone, address
- Search by name/code/email; paginated (25/page)

### Sites
- Full CRUD with linked customer
- Fields: name, code, customer, address, city, state, postcode, country (default: Australia)
- Asset count in list — links to filtered assets view
- Filter by customer; search by name/code

### Assets
- Full CRUD with linked site
- Fields: name, asset type, make, model, serial number, Maximo ID (reference only), install date, job plan (dropdown), dark site test (boolean)
- Each asset links to one job plan (1:1 asset type → job plan template)
- Expandable protection settings section (conditional electrical fields)
- Filter by site/type; search by name/type/serial/Maximo ID
- List columns: Maximo ID, Name, Site, Location, Job Plan, Status
- File attachments (PDF, images, XLSX, DOCX, CSV, TXT — 10MB max)
- CSV import: upload → auto column mapping (fuzzy match) → 5-row preview → site name resolution → validation → bulk insert with per-row error report (max 500 rows)

### Job Plans
- Full CRUD — maintenance checklist templates aligned with IBM Maximo
- Fields: name, code (job code), type, description
- Frequency lives on individual items (not the plan) — boolean flags: monthly, quarterly, semi-annual, annual, 2yr, 3yr, 5yr, 8yr, 10yr
- Dark site flag on items — tasks only performed during black start testing
- Inline item management: add/edit/delete items with description, sort order, required flag, frequency flags, dark site flag
- List columns: Job Code, Name, Type, Tasks, Status
- Filter by site; search by name

### Maintenance Checks (Maximo-Aligned)
- **Two creation paths:**
  - **Path A (auto):** Select site + frequency → system finds all assets at that site whose job plans have items matching that frequency → generates per-asset tasks
  - **Path B (manual):** Customer provides list of Maximo asset IDs + work orders → paste IDs to create check for specific assets
- Auto-named: "Site - Month - Year" (e.g. "SY2 - April - 2026")
- **Check hierarchy:** Maintenance Check → check_assets (junction, per-asset status/WO#/notes) → maintenance_check_items (per-asset tasks)
- **Full-page detail view** at `/maintenance/[id]`:
  - Header: status badge, site, due date, assigned to, frequency
  - Full-width sortable asset table: ID, Name, Location, Work Order #, Job Plan, Done, Notes
  - Click any asset row → expands to show outstanding tasks with Order, Task, Result (Pass/Fail/NA buttons), Comments
  - Inline-editable Work Order # and Notes per asset
  - Paste WO#s from Excel (bulk apply in sort order)
  - Force-complete per asset (marks all tasks as pass)
- Fields: site, frequency (monthly through 10yr), is_dark_site, start_date, due_date, custom_name, assigned_to, maximo_wo_number, maximo_pm_number, notes
- Status lifecycle: Scheduled → In Progress → Complete / Cancelled
- Complete blocked until all required items have a result (N/A counts)
- Cancel: admin only
- Attachments: supervisor+ or assigned technician can upload
- Filter by site/status; search by check name/site name
- All table rows clickable — no icon action columns

### Test Records
- Full CRUD for general electrical tests
- Fields: asset (auto-fills site), test type, test date, tested by, result (Pending/Pass/Fail/Defect), next test due, notes
- Inline readings: add/delete (label, value, unit, pass/fail)
- Attachments: supervisor+ upload
- Filter by site/result; search by asset/site/test type

### Compliance Reports
- Filter: site + date range
- KPI cards: Maintenance Compliance %, Overdue Checks, Test Pass Rate %, Test Defects
- Colour thresholds: green ≥80%, amber ≥50%, red <50%
- Charts: maintenance status distribution, test result distribution (horizontal bar)
- Overdue by site: top 5
- Recent failures: last 10 failed/defect tests

### Admin — User Management
- Invite by email (Supabase invite flow with assigned role)
- Toggle active/inactive; change role
- Cannot self-deactivate or self-demote

### Admin — Tenant Settings
- Edit: product name, logo URL, brand colours
- Live colour preview strip
- Changes apply on next page load

---

### ACB Test Records ✅
- Full CRUD for Air Circuit Breaker tests
- Fields: asset (auto-fills site), test date, tested by, test type (Initial/Routine/Special), overall result (Pending/Pass/Fail/Defect), notes
- Circuit breaker details: CB make, CB model, CB serial number
- Inline readings: add/delete (label, value (required), unit, pass/fail)
- Attachments: supervisor+ upload, admin delete. Entity type: `acb_test`
- Filter by site/result; search by asset name, CB make, CB model, test type
- Dashboard: ACB Test stats row (Total/Passed/Failed/Defects)
- Sidebar: ACB Testing nav link with Shield icon

### ACB Reports (DOCX) ✅
- Per-site report covering all active ACB tests — generated on demand from ACB Testing page
- Report structure matches Delta Elcom ACB test report template:
  - **Cover page:** Site name + year, generated date, tenant product name (white-label)
  - **Table of Contents:** Auto-generated from breaker headings
  - **Per-breaker sections** (one per ACB test):
    - Header table: Site, Asset, Location, ID, Job Plan
    - Circuit Breaker Details: 24-attribute grid (brand, breaker type, serial, protection settings, trip unit, poles, current rating, shunt/close/UV accessories)
    - Visual / Functional Test Results: 3 quick items + 27-row checklist with section groupings (Visual Inspection, Mechanical degreasing, Device Functional Check, Auxiliaries Check, Device Racking In, greasing, Overall)
    - Electrical Testing: Main Contact Resistance (3 phases), Insulation Resistance Closed (9 measurements), Insulation Resistance Open (4 measurements), Secondary Injection, Operation Counter After
    - Protection Test Results: Short time, Instantaneous, Long time — current levels, trip times, pass/fail
- White-label: heading colour from tenant primary colour, Plus Jakarta Sans font
- Download: API route `GET /api/acb-report?site_id=xxx` returns DOCX attachment
- Permissions: supervisor+ to generate
- Readings matched to template sections by label (case-insensitive)

### NSX / MCCB Test Records ✅
- Full CRUD for NSX/MCCB circuit breaker test records
- Schema: `nsx_tests` (asset_id, site_id, test_date, tested_by, test_type Initial/Routine/Special, cb_make, cb_model, cb_serial, cb_rating, cb_poles, trip_unit, overall_result Pending/Pass/Fail/Defect, is_active) + `nsx_test_readings` (label, value required, unit, is_pass, sort_order)
- CB detail fields include rating, poles, and trip unit (not in ACB schema — NSX-specific)
- Readings: inline add/delete, same pattern as ACB
- Attachments: entity_type `nsx_test`
- RLS: tenant-scoped read, supervisor+ create/edit, admin delete
- Dashboard: NSX Tests stats row
- Sidebar: CircuitBoard icon

### NSX Reports (DOCX) ✅
- Per-site NSX/MCCB report — same pattern as ACB reports
- Report structure:
  - Cover page: Site name, year, generated date, white-label branding
  - Table of Contents
  - Per-breaker sections: header table, CB details (16 attributes), visual/functional checklist (16 items), electrical testing (contact resistance, IR closed, IR open), trip test results (long time, short time, instantaneous, earth fault)
- Download: API route `GET /api/nsx-report?site_id=xxx`
- Permissions: supervisor+

### Audit Log ✅
- Immutable audit trail of all significant user actions
- Schema: `audit_logs` table with tenant_id, user_id, action (varchar 50), entity_type, entity_id, summary, metadata (jsonb)
- RLS: tenant-scoped read for admins only; insert for authenticated users; no update or delete policies (immutable)
- Shared `logAuditEvent()` action in `lib/actions/audit.ts` — silent failure (try/catch) so audit never blocks primary operations
- Admin-only viewer at `/audit-log` with:
  - Paginated DataTable (25/page)
  - Filters: entity type dropdown, action dropdown
  - Colour-coded action badges: create (green), update (blue), delete (red), login (purple), export (amber)
  - User name resolution from profiles
- 5 database indexes for performance (tenant_id, user_id, action, entity_type, created_at)
- Sidebar: ScrollText icon in Admin section

### Global Search ✅
- Single search input that queries across 6 entity tables in parallel
- Tables searched: assets, sites, customers, acb_tests, nsx_tests, instruments
- Pattern matching: `.or()` with `ilike` on name/title/code fields per entity
- Returns typed `SearchResult[]` with type, id, title, subtitle, href (clickable to entity)
- Type-specific icons: Package (assets), MapPin (sites), Building2 (customers), Shield (ACB), CircuitBoard (NSX), Wrench (instruments)
- Coloured type badges for visual distinction
- Sidebar: Search icon in main nav

### Instrument Register ✅
- Full CRUD for test instruments and calibration tracking
- Schema: `instruments` table with name, instrument_type, make, model, serial_number, asset_tag, calibration_date, calibration_due, calibration_cert, status (CHECK: Active/Out for Cal/Retired/Lost), assigned_to (FK profiles), notes, is_active
- RLS: tenant-scoped read, supervisor+ create/edit, admin deactivate
- List view with:
  - Filters: status dropdown, instrument type dropdown
  - Calibration due date highlighting (red if overdue)
  - Status badges mapped to StatusBadge component (Active=active, Out for Cal=not-started, Retired=inactive, Lost=blocked)
  - Assignee name resolution
- Detail panel: calibration section with last calibrated date, due date (red if overdue), certificate reference
- Form: SlidePanel with calibration section, status dropdown, assigned_to user picker
- Sidebar: Wrench icon in main nav

### User Management (Enhanced) ✅
- `requireAdmin()` updated to support both `super_admin` and `admin` roles
- Self-demotion check updated: admins and super_admins cannot demote themselves below admin
- Role hierarchy enforced consistently across invite, role change, and active toggle actions

---

## Modules (Planned)

| Module | Sprint | Description |
|--------|--------|-------------|
| CI/CD | 17 | Automated build + deploy pipeline |
| Analytics | 17 | Usage trends, bulk reporting, archive |
| Offline Mode | Backlog (CR-001) | Tablet offline entry with sync — +4 sprint estimate |

---

## Business Rules

- No hard deletes — `is_active` soft delete on all entities (except consumed MFA codes and removed job plan items)
- Job plan items copied to check at creation — subsequent plan edits don't affect existing checks
- CSV import maximum: 500 rows per file; site names must match existing records
- Attachments: 10MB max; PDF/JPG/PNG/XLSX/DOCX/CSV/TXT only
- Signed download URLs expire after 1 hour
- Pagination: 25 records per page default
- WCAG 2.1 AA contrast minimum on all text

---

## Acceptance Criteria

### Auth
- [ ] Sign-in with email + password works
- [ ] No MFA → redirect to enrolment before app access
- [ ] TOTP accepted from authenticator app
- [ ] Recovery code consumed on use, forces re-enrolment
- [ ] Deactivated user signed out on next request
- [ ] Admin cannot self-deactivate or self-demote

### Assets
- [ ] List renders with site/type filters functional
- [ ] Create/edit validates required fields
- [ ] CSV import: column mapping, preview, site validation, per-row error report
- [ ] Attachments: upload, download (signed URL), delete (admin)
- [ ] Protection settings conditional display works

### Maintenance Checks (Maximo-Aligned)
- [ ] Path A creation: site + frequency auto-finds matching assets and generates per-asset tasks
- [ ] Path B creation: manual Maximo asset IDs accepted, check created for those specific assets
- [ ] Auto-naming: check named "Site - Month - Year"
- [ ] check_assets junction created with correct asset links
- [ ] Per-asset tasks filtered by frequency boolean flags on job plan items
- [ ] Full-page detail at `/maintenance/[id]` with sortable asset table
- [ ] Click asset row → expands to show outstanding tasks with Pass/Fail/NA
- [ ] Paste WO#s from Excel applies in current sort order
- [ ] Force-complete marks all asset tasks as pass
- [ ] Inline-editable WO# and Notes per asset
- [ ] Items not editable until check is In Progress
- [ ] Complete blocked with incomplete required items (N/A is valid)
- [ ] Supervisor and assigned technician can both upload attachments
- [ ] Admin cancel works; non-admins cannot cancel

### Test Records
- [ ] Asset selection auto-fills site
- [ ] Readings add/delete inline
- [ ] Result badge correct colour per result

### ACB Test Records
- [ ] List renders with site/result filters functional
- [ ] Create/edit validates required fields (asset, test date)
- [ ] Asset selection auto-fills site (read-only)
- [ ] CB details section (make, model, serial) displayed in detail view
- [ ] Readings add/delete inline; value is required
- [ ] Result badge correct colour per result (Pending/Pass/Fail/Defect)
- [ ] Attachments: upload (supervisor+), download (signed URL), delete (admin)
- [ ] Dashboard ACB stats row shows correct counts
- [ ] Sidebar link to ACB Testing present

### ACB Reports
- [ ] Generate Report button visible to supervisor+ only
- [ ] Site picker populated with all active sites
- [ ] DOCX downloads with correct filename (site name + date)
- [ ] Cover page shows site name, year, tenant product name
- [ ] TOC links to each breaker section
- [ ] Per-breaker CB details table shows 24 attributes, populated from readings + CB fields
- [ ] Visual/functional checklist has 3 quick items + 27 checklist rows
- [ ] Electrical testing tables render contact resistance, IR closed, IR open
- [ ] Protection test results table with short time, instantaneous, long time rows
- [ ] White-label: heading colour matches tenant primary colour
- [ ] Empty readings render as blank cells (no errors)

### NSX Test Records
- [ ] NSX Testing page lists tests with asset, make/model, rating, site, date, result
- [ ] Create form includes CB rating, poles, trip unit fields
- [ ] Detail panel shows 6 CB fields (make, model, serial, rating, poles, trip unit)
- [ ] Readings inline add/delete, pass/fail per reading
- [ ] Attachments supported (entity_type: nsx_test)
- [ ] Dashboard shows NSX test stats
- [ ] Sidebar shows NSX Testing with CircuitBoard icon

### NSX Reports
- [ ] Generate Report button visible to supervisor+ only
- [ ] DOCX downloads with correct filename
- [ ] Cover page shows site name, year, tenant branding
- [ ] Per-breaker CB details table with 16 attributes
- [ ] Visual/functional checklist with 16 items
- [ ] Electrical testing tables render correctly
- [ ] Trip test results with 4 protection rows (long/short/instantaneous/earth fault)

### Audit Log
- [ ] Audit log page accessible to admin/super_admin only
- [ ] List renders with entity type and action filters
- [ ] Colour-coded action badges (create=green, update=blue, delete=red, login=purple, export=amber)
- [ ] Paginated at 25 per page
- [ ] User names resolved from profiles
- [ ] Audit records are immutable — no edit or delete in UI or DB
- [ ] Sidebar shows Audit Log in Admin section

### Global Search
- [ ] Search input queries assets, sites, customers, ACB tests, NSX tests, instruments
- [ ] Results show type-specific icons and coloured type badges
- [ ] Clicking a result navigates to the entity's page
- [ ] Empty search state handled gracefully
- [ ] Sidebar shows Search link

### Instrument Register
- [ ] List renders with status and type filters
- [ ] Create/edit validates required fields (name, instrument_type)
- [ ] Status options: Active, Out for Cal, Retired, Lost
- [ ] Calibration due date highlighted red when overdue
- [ ] Assignee resolved to user name from profiles
- [ ] Detail panel shows calibration section with date, due, certificate
- [ ] Admin can deactivate/reactivate instruments
- [ ] Sidebar shows Instruments link with Wrench icon

### User Management (Enhanced)
- [ ] Super admin can access user management
- [ ] Admin and super_admin roles both grant user management access
- [ ] Cannot self-demote below admin level
- [ ] Cannot self-deactivate
- [ ] Role changes take effect immediately

### White-Label
- [ ] Colour changes apply without redeploy
- [ ] Logo or product name fallback in sidebar and auth screens
- [ ] Tenant A data is invisible to Tenant B

---

## User Manual Source Material

> Accumulated per sprint. Used to author the final user manual.

### Auth & Platform (Sprints 1–3)
- Sign-in is email + password. No self-registration — admin must invite users.
- MFA is mandatory. Prompted at first login. Google Authenticator or Microsoft Authenticator required.
- Recovery codes shown once at enrolment. Each code works once only. Save them securely.
- Forgotten password: use "Forgot password" on the sign-in page. Reset link sent by email.
- Brand colours and product name: Admin → Settings. Changes take effect on next page load.

### Core Data (Sprints 4–6)
- Customers must exist before sites. Sites must exist before assets.
- Deactivating a record hides it from active lists but preserves all history and linked data.
- Job plans are reusable templates. The same plan can generate multiple checks at different times.
- Frequency on a job plan is a label — the system does not auto-create checks. Checks are created manually by a supervisor or admin.

### Audit, Search & Instruments (Sprints 15–16)
- Audit log: admin-only view of all significant platform actions. Records are permanent and cannot be edited or deleted.
- Global search: one search box covers assets, sites, customers, ACB tests, NSX tests, and instruments. Results are clickable links.
- Instrument register: track test instruments with calibration dates. Overdue calibrations flagged in red. Statuses: Active, Out for Cal, Retired, Lost.
- User management now supports super_admin role alongside admin for user administration.

### Workflows (Sprints 7–11)
- Maintenance checks are created by supervisors or admins and assigned to a technician.
- Technicians start the check themselves when ready. Items cannot be recorded until Started.
- A check cannot be completed if any required item has no result. N/A is acceptable.
- Attachments (photos, sign-off docs, inspection reports) can be added to checks and test records.
- CSV asset import: prepare file with required columns, import via Assets → Import. Max 500 rows. Site names must exactly match existing site records.
- Attachment download links expire after 1 hour. Return to the record and click download again if the link fails.
