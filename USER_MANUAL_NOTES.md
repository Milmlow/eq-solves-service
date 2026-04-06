# USER MANUAL NOTES — EQ Solves PM Platform

Last updated: 2026-04-06 · After Sprint 17 (Phase 5 Complete)
Purpose: Raw material for the user manual. Compiled during development — assembly only at the end.
Maintained by: Cowork (append notes each sprint when new features ship)

---

## How to use this file

This file is not the manual — it's the ingredients. Each section captures:
- What the feature does in plain language (non-technical)
- Any edge cases or gotchas users will hit
- Error states and what to do
- Role-based access notes (who can do what)

Sprint 17 is now complete. This file feeds directly into the manual without needing to reverse-engineer anything from code.

**When generating the final user manual:** strip the "Sprint Notes for Manual" section at the bottom — it is internal scaffolding only. Strip this instruction block too.

---

## Product Overview

**EQ Solves** is a preventative maintenance and electrical test management platform built for trade contractors working in high-compliance environments (data centres, commercial electrical).

It replaces spreadsheets and disconnected tools with a single system for:
- Tracking all electrical assets across multiple customer sites
- Scheduling and executing preventative maintenance checks
- Recording electrical test results (ACB, NSX, general)
- Generating compliance reports
- Producing formal test documentation (ACB reports, PM records)

---

## Getting Started

### Logging In

1. Navigate to the EQ Solves URL provided by your administrator
2. Enter your email address and password
3. Enter the 6-digit code from your authenticator app (Google Authenticator or Microsoft Authenticator)
4. You are now in the dashboard

**First time only:** You will be asked to set up two-factor authentication before accessing the app. Open your authenticator app, scan the QR code, enter the 6-digit code to confirm, then save your recovery codes somewhere safe — they are shown once only.

**Forgot your password:** Click "Forgot password" on the sign-in page. A reset link will be sent to your email.

**Lost your authenticator app:** Use one of your recovery codes on the MFA screen. This will reset your two-factor authentication and prompt you to set it up again.

---

## Roles and Permissions

EQ Solves has five user roles. Your administrator assigns your role when they invite you.

| Role | What you can do |
|------|----------------|
| **Read Only** | View all records. No changes. |
| **Technician** | View records. Execute maintenance checks assigned to you. Upload attachments on your assigned checks. |
| **Supervisor** | Everything a Technician can do, plus: create and edit assets, maintenance checks, test records, job plans, customers, sites. |
| **Admin** | Everything a Supervisor can do, plus: manage users, deactivate records, delete attachments, cancel maintenance checks. Access tenant settings. |
| **Super Admin** | Platform-level access across all tenants. EQ Solves staff only. |

---

## Dashboard

The dashboard gives you a live overview of the platform.

**KPI Cards (top row):** Total counts for Customers, Sites, Assets, and Job Plans. Click any card to go to that list.

**Maintenance Stats:** Today's count of Scheduled, In Progress, Overdue, and Complete maintenance checks. Overdue checks show in amber — these need attention.

**Test Records Stats:** Counts of Total, Passed, Failed, and Defect test records. Defects show in red.

**ACB Test Stats:** Total, Passed, Failed, and Defect counts for ACB tests specifically.

**NSX Test Stats:** Total, Passed, Failed, and Defect counts for NSX tests specifically.

---

## Customers

Customers are the companies that own the sites you maintain (e.g., Equinix, Schneider Electric).

**Adding a customer:** Customers → New Customer. Required: Name. Optional: code, email, phone, address.

**Finding sites for a customer:** Open the customer, click the "Sites" link to see all sites linked to that customer.

**Deactivating a customer:** Admin only. Deactivated customers remain in the system but are greyed out. Their sites and assets are unaffected.

---

## Sites

Sites are physical locations where assets are installed (e.g., SY1 Data Centre, MEL1 Substation).

**Adding a site:** Sites → New Site. Required: Name, Customer. Optional: code, address details.

**Asset count:** The sites list shows how many assets are registered at each site. Click the number to view those assets directly.

---

## Asset Register

The asset register is the central record of every piece of electrical equipment across all sites.

### Finding assets

Use the search bar to search by asset name, type, serial number, or Maximo ID. Use the dropdowns to filter by site or asset type.

### Asset fields

| Field | Description |
|-------|-------------|
| Name | The asset's identifier (e.g., "ACB-MCC1-A") |
| Asset Type | Category (e.g., ACB, NSX, Switchboard, ATS) |
| Site | The site where the asset is installed |
| Serial Number | Manufacturer serial number |
| Maximo ID | Reference ID from IBM Maximo (if used by your client) — stored for reference only, no live sync |
| Make / Model | Manufacturer and product model |
| Install Date | Date the asset was installed |
| Protection Settings | Trip unit settings (Ir, Isd, Ii, Ig) — expandable section, conditional fields based on asset type |

### Importing assets from CSV

If you have an existing asset list in Excel or CSV format:

1. On the Assets page, click **Import**
2. Upload your CSV file
3. EQ Solves will try to automatically match your column headings to the correct fields
4. Review the column mapping — adjust any that didn't match correctly
5. Check the 5-row preview to confirm the data looks right
6. Click Import to load the assets

**Limits:** Maximum 500 assets per import. Required columns: name, asset type, site name.

**If a site name doesn't match:** The import will flag any site names in your file that don't exist in EQ Solves. You'll need to either create the site first or correct the name in your file.

---

## Job Plans

Job plans are reusable checklists that define what tasks need to be done during a maintenance visit.

**Example:** A "Monthly ACB Inspection" job plan might include items like "Check bus bar connections", "Test trip unit operation", "Record thermal readings".

**Frequency options:** Weekly / Monthly / Quarterly / Bi-annual / Annual / Ad Hoc

**Required items:** Individual checklist items can be marked as required. A maintenance check cannot be marked complete until all required items have a result.

**Important:** Changing a job plan does not affect maintenance checks that are already in progress. The tasks are copied when the check is created.

---

## Maintenance Checks

Maintenance checks are the scheduled instances of a job plan being executed at a site.

### Check statuses

| Status | Meaning |
|--------|---------|
| Scheduled | Created, not yet started |
| In Progress | Technician has started work |
| Complete | All required items done, check signed off |
| Overdue | Due date has passed, not yet complete |
| Cancelled | Cancelled by admin — remains in system for audit |

### Creating a check

1. Maintenance → New Check
2. Select a job plan (the checklist to use)
3. Set the due date
4. Assign a technician
5. Add any notes
6. Click Create

The check is created with all items from the selected job plan copied in.

### Executing a check (Technician)

1. Open the maintenance check assigned to you
2. Click **Start Check**
3. Work through each item — tap Pass ✓, Fail ✗, or N/A — for each one
4. Add notes to any item that needs explanation
5. Once all required items have a result, click **Complete Check**

**Attachments:** You can upload photos, PDFs, or other documents to a check while it is in progress. Useful for attaching thermal images, sign-off sheets, or photos of defects found.

### Completing a check

The Complete button is locked until all items marked as "required" have a result (pass, fail, or n/a). If you can't complete an item, mark it N/A and add a note explaining why.

---

## Test Records

Test records capture the results of formal electrical testing (e.g., insulation resistance testing, protection relay testing, earth fault loop testing).

**Difference from maintenance checks:** Maintenance checks are scheduled recurring inspections with pass/fail items. Test records are for formal test events with specific numerical measurements and a documented result.

### Test result types

| Result | Meaning |
|--------|---------|
| Pending | Test recorded but not yet assessed |
| Pass | Asset passed the test |
| Fail | Asset failed — may need rectification |
| Defect | Defect noted — requires follow-up |

### Readings

Each test record can have multiple readings — individual measurements taken during the test. Fields: label (what was measured), value, unit, and pass/fail for that specific reading.

**Example readings for an insulation resistance test:**
- Label: "IR Phase A to Earth" / Value: 850 / Unit: MΩ / Pass: ✓
- Label: "IR Phase B to Earth" / Value: 820 / Unit: MΩ / Pass: ✓
- Label: "IR Phase C to Earth" / Value: 310 / Unit: MΩ / Pass: ✗

### Attachments on test records

Upload test certificates, thermal images, or supporting documents directly to the test record.

---

## ACB Test Records

ACB (Air Circuit Breaker) testing is a specialised module for recording the results of formal ACB inspections and testing at your sites.

### Creating an ACB test

1. Go to **ACB Testing** in the sidebar
2. Click **Add ACB Test**
3. Select the asset being tested — the site will automatically fill in
4. Enter the test date and who performed the test
5. Fill in the circuit breaker details: make (e.g. ABB, Schneider), model (e.g. Emax E2), and serial number
6. Select the test type: **Initial** (first test on new equipment), **Routine** (scheduled periodic test), or **Special** (follow-up or investigation)
7. Set the overall result: Pending, Pass, Fail, or Defect
8. Add any notes
9. Click Create

### Adding readings

Readings capture individual measurements taken during the test (e.g., contact resistance per phase, insulation resistance, trip timing).

1. Open an ACB test record
2. In the Readings section, click **Add Reading**
3. Enter the label (what was measured, e.g. "Contact Resistance Phase A")
4. Enter the value (required) and unit (e.g. "45 μΩ")
5. Select Pass or Fail for that specific reading, or leave as "Not assessed"
6. Click Add

You can delete any reading by clicking the bin icon next to it.

### Attachments

Upload test certificates, thermal images, or supporting documents to any ACB test record. The same rules apply as other attachments: 10 MB max, supervisor+ can upload, admin can delete.

### Who can do what

| Action | Who |
|--------|-----|
| View ACB tests | All roles |
| Create / edit ACB tests | Supervisor, Admin, Super Admin |
| Add / delete readings | Supervisor, Admin, Super Admin |
| Upload attachments | Supervisor, Admin, Super Admin |
| Delete attachments | Admin, Super Admin |
| Deactivate / reactivate a test | Admin, Super Admin |

### Dashboard

The Dashboard now includes an **ACB Tests** row showing total tests, passed, failed, and defects. Click any number to jump to the filtered ACB Testing list.

---

## Compliance Reports

The compliance reports page gives a site-by-site and date-range view of maintenance and testing performance.

**Maintenance Compliance %:** Percentage of maintenance checks completed on time within the selected period. Green ≥80%, amber ≥50%, red <50%.

**Test Pass Rate %:** Percentage of test records with a Pass result.

**Overdue by site:** Which sites have the most overdue maintenance checks — sorted by worst first.

**Recent failed tests:** The last 10 test records with a Fail or Defect result. Use this to quickly identify assets needing follow-up.

**Filtering:** Use the site dropdown and date range to narrow the report. Useful for preparing a compliance report for a specific client.

---

## Analytics Dashboard

The analytics dashboard provides a 12-month trend view of testing and maintenance performance across your organisation.

**Accessing analytics:** Click **Analytics** in the sidebar (BarChart3 icon).

### KPI cards (top row)

| Card | What it shows |
|------|--------------|
| Total Assets | Count of all active assets |
| Total Sites | Count of all active sites |
| Total Tests | Combined count of general, ACB, and NSX tests |
| Pass Rate % | Percentage of all tests with a Pass result |
| Compliance % | Percentage of maintenance checks completed on time |
| Overdue Checks | Number of maintenance checks past their due date |

### Charts

**12-Month Test Volume:** A stacked bar chart showing how many general tests, ACB tests, and NSX tests were recorded each month over the past 12 months. Useful for spotting seasonal trends or drops in testing activity.

**Compliance Trend:** A line chart showing monthly maintenance compliance percentage over 12 months. Colour-coded: green (80%+), amber (50–79%), red (below 50%).

**Pass Rate by Test Type:** Breakdown of pass rates for general tests, ACB tests, and NSX tests individually. Shows the percentage as a bar with the count of pass vs total.

**Instrument Calibration Status:** Summary of active instruments, instruments currently out for calibration, and overdue calibrations. Links directly to the instruments page.

### Who can see analytics

All roles can view the analytics dashboard.

---

## Bulk Report Export

You can download all ACB and NSX test reports for a site as a single ZIP file.

1. Go to **Reports** in the sidebar
2. In the Bulk Export section, select a **site** from the dropdown
3. Click **Export ZIP**
4. A ZIP file will download containing one DOCX report per test type (ACB and NSX) for all active tests at that site

**Who can export:** Supervisors, Admins, and Super Admins only.

**If no tests exist:** The export will return an error message explaining that no active tests were found for the selected site.

---

## Archiving Records

Most records in EQ Solves can be archived (soft-deleted) rather than permanently removed. Archived records are hidden from default list views but remain in the system for audit and compliance purposes.

### How to archive

Admin users can deactivate records by opening the record detail and clicking **Deactivate**. The record will no longer appear in default list views.

### Viewing archived records

On any list page (assets, customers, sites, job plans, test records, ACB tests, NSX tests, instruments), toggle **Show Archived** to include deactivated records. Archived records appear greyed out.

### Reactivating

Admin users can reactivate any archived record by opening it and clicking **Reactivate**. The record returns to active status immediately.

### What can be archived

Customers, sites, assets, job plans, test records, ACB tests, NSX tests, and instruments all support archive/reactivate. Maintenance checks use a different lifecycle (scheduled → complete → cancelled) and are not archivable.

---

## File Attachments (General)

Attachments can be added to maintenance checks and test records.

**Supported file types:** PDF, images (JPG, PNG, GIF, WEBP), Excel (.xlsx), Word (.docx), CSV, plain text (.txt)

**Maximum file size:** 10 MB per file

**Downloading:** Click the filename to download. Download links expire after 1 hour — click the file again to generate a fresh link.

**Deleting:** Admin only. Deleted files cannot be recovered.

---

## Tenant Settings (Admin)

Settings → Tenant Settings

Admins can customise:
- **Product name** — shown in the sidebar and browser tab
- **Brand colours** — primary, deep, ice, and ink colours (live preview strip)
- **Support email** — displayed to users when they need help
- **Logo** — currently via URL (file upload coming in a later sprint)

Changes take effect immediately for any user who loads a new page after saving.

---

## User Management (Admin)

Admin → Users

### Inviting a new user
1. Click Invite User
2. Enter their email address
3. Select their role
4. Click Send Invite

The user will receive an email with a link to set their password and set up two-factor authentication.

### Changing a user's role
Open the user, change the role dropdown, save. Takes effect immediately.

### Deactivating a user
Toggle the user to inactive. They will be signed out on their next page load and cannot sign back in. Their historical records are preserved.

**Note:** You cannot deactivate your own account.

---

## NSX / MCCB Testing

The NSX Testing module works the same way as ACB Testing but is designed for Moulded Case Circuit Breakers (MCCBs) — Schneider NSX range and equivalents.

### Creating an NSX test

1. Go to **NSX Testing** in the sidebar
2. Click **Add NSX Test**
3. Select the **Asset** — the site auto-fills from the asset
4. Enter the test date and select who performed the test
5. Fill in the **Circuit Breaker Details**: make, model, serial, rating (e.g. 400A), poles (e.g. 3P, 4P), and trip unit (e.g. Micrologic 5.3E)
6. Set the test type (Initial, Routine, or Special) and overall result
7. Click **Create Test**

### NSX-specific fields

Compared to ACB tests, NSX tests include three additional fields: **Rating** (the breaker's current rating), **Poles** (number of poles), and **Trip Unit** (the specific trip unit model fitted). These appear in both the form and the detail panel.

### Adding readings

Same as ACB — open the test detail, click **Add Reading**, enter label, value, unit, and pass/fail.

### Generating an NSX report

1. On the NSX Testing page, select a **site** from the dropdown
2. Click the **Report** button
3. The report downloads as a Word document with per-breaker sections covering CB details, visual/functional checks, electrical testing, and trip test results

### Permissions

Same as ACB: Supervisors, Admins, and Super Admins can create, edit, and generate reports. Technicians can view only.

---

## ACB Test Reports

You can generate a formal DOCX report for all ACB tests at a given site. The report follows a standard format used across the industry for ACB testing documentation.

### Generating a report

1. Go to **ACB Testing** in the sidebar
2. In the top-right area, select a **site** from the "Site for report" dropdown
3. Click the **Report** button
4. The report will download as a Word document (.docx)

### What the report includes

The report contains one section per breaker tested at the selected site. Each section includes:

- A header table showing the site, asset name, location, and reference ID
- **Circuit Breaker Details** — a grid of 24 attributes covering the breaker brand, type, serial number, protection unit settings (Ir, Isd, Ii, Ig), trip unit model, current rating, and fitted accessories (shunt trip, close coil, undervoltage, motor charge)
- **Visual / Functional Test Results** — a pre-service checklist with 27 items grouped by section (Visual Inspection, Mechanical degreasing, Device Functional Check, Auxiliaries Check, Device Racking In, greasing, Overall). Also includes operation counter and safety shutter checks
- **Electrical Testing** — tables for main contact resistance (3 phases), insulation resistance closed (9 measurements), insulation resistance open (4 measurements), secondary injection test, and operation counter after
- **Protection Test Results** — short time, instantaneous, and long time protection with current levels, trip times, and pass/fail

The cover page shows the site name, year, and the date the report was generated. It uses your organisation's branding (colours and product name from tenant settings).

### Tips

- Make sure readings are entered with clear labels that match the template sections (e.g. "Contact Resistance Red Phase", "IR Closed Red > White"). The report matches readings by label
- CB details (make, model, serial) come from the ACB test record itself. Protection settings come from readings
- Only active ACB tests are included in the report

### Who can generate reports

Supervisors, Admins, and Super Admins can generate ACB reports. Technicians and Read Only users cannot.

---

## Audit Log (Admin)

The audit log records every significant action on the platform — creating records, updating data, deleting items, logins, and report exports. This is a read-only view. Records cannot be edited or deleted.

**Accessing the audit log:** In the sidebar under the Admin section, click **Audit Log**.

**Filtering:** Use the entity type and action dropdowns to narrow down the log. For example, filter to "asset" entity type and "create" action to see all new assets added.

**Action colour coding:**

| Colour | Action type |
|--------|------------|
| Green | Create — a new record was added |
| Blue | Update — an existing record was changed |
| Red | Delete — a record was deactivated or removed |
| Purple | Login — a user signed in |
| Amber | Export — a report was generated or data exported |

**Who can see the audit log:** Admin and Super Admin only. Other roles do not see the Audit Log link in the sidebar.

---

## Global Search

The search page lets you find any record across the entire platform from a single search box.

**Using search:** Click **Search** in the sidebar, then type your search term. Results appear as you type, grouped by type (assets, sites, customers, ACB tests, NSX tests, instruments).

**Result types are colour-coded** with icons:
- Assets (package icon), Sites (pin icon), Customers (building icon), ACB Tests (shield icon), NSX Tests (circuit board icon), Instruments (wrench icon)

**Clicking a result** takes you directly to that record's page.

**What is searched:** The search checks name, code, serial number, and similar identifying fields across all entity types. It does not search inside notes, readings, or attachment filenames.

---

## Instrument Register

The instrument register tracks test instruments (multimeters, insulation testers, thermal cameras, etc.) including their calibration status.

### Adding an instrument

1. Go to **Instruments** in the sidebar
2. Click **Add Instrument**
3. Enter the instrument name, type (e.g., Insulation Tester, Multimeter), make, model, and serial number
4. Optionally enter an asset tag (internal reference number)
5. Set the calibration details: last calibrated date, next due date, and certificate reference
6. Assign the instrument to a user if applicable
7. Click Create

### Calibration tracking

The instruments list highlights overdue calibrations in red. If an instrument's calibration due date has passed, it will show "(Overdue)" in red next to the date.

### Instrument statuses

| Status | Meaning |
|--------|---------|
| **Active** | In service, available for use |
| **Out for Cal** | Sent away for calibration — not available |
| **Retired** | Permanently removed from service |
| **Lost** | Cannot be located |

### Who can do what

| Action | Who |
|--------|-----|
| View instruments | All roles |
| Create / edit instruments | Supervisor, Admin, Super Admin |
| Deactivate / reactivate | Admin, Super Admin |

---

## Glossary

| Term | Definition |
|------|-----------|
| ACB | Air Circuit Breaker — high-capacity circuit breaker used in data centre power distribution |
| NSX | Schneider NSX series compact circuit breaker |
| MCCB | Moulded Case Circuit Breaker — medium-capacity breaker |
| MCB | Miniature Circuit Breaker — low-capacity breaker for sub-distribution |
| PM | Preventative Maintenance — scheduled inspections and servicing |
| Trip Unit | Electronic protection device in a circuit breaker that detects fault conditions |
| Ir | Long Time protection pickup current |
| Isd | Short Time protection pickup current |
| Ii | Instantaneous protection pickup current |
| Ig | Earth Fault protection pickup current |
| Maximo | IBM asset management system used by some clients (e.g., Equinix). IDs stored as reference only, no live sync. |
| White-label | The ability for each customer to see their own brand (logo, colours, name) in the platform |
| Audit Log | Permanent, read-only record of all significant actions taken on the platform |
| Calibration | Periodic verification and adjustment of test instruments to ensure measurement accuracy |
| Job Plan | Reusable checklist template with frequency-based items for maintenance |
| Tenant | A company or organisation using the platform under their own branding |

---

## Known Limitations (v1)

| Limitation | Notes |
|-----------|-------|
| Dark mode | Not supported in v1 |
| M365 / Azure AD SSO | Email/password + MFA is the only login method in v1 |
| Offline mode | Not supported — internet connection required |
| Logo upload | Currently URL input only — file upload coming in a later sprint |
| CSV import limit | 500 assets maximum per import file |
| Attachment download links | Expire after 1 hour — click the file again to generate a fresh link |

---

## Sprint Notes for Manual

**INTERNAL ONLY — strip this section when generating the final user manual.**

### Sprints 1–3 (Foundation)
- Auth system fully operational including MFA and recovery codes
- White-label engine works — each tenant sees their own colours and product name
- Core data model established

### Sprints 4–6 (Core Data)
- Customer and Site management live
- Asset Register live — search, filter, create, edit
- Job Plans live — reusable maintenance checklists with ordered items and frequency settings
- Tenant Settings editor live

### Sprint 7 (Maintenance Checks)
- Full maintenance check workflow live: create → start → execute (per item) → complete
- Template-instance pattern: job plan changes don't affect in-progress checks
- Technician self-service: assigned technician can work their own check without supervisor intervention

### Sprints 8–9 (Test Records + Reports)
- Test Records live: create, edit, readings (inline), pass/fail, result badges
- Compliance Reports live: KPI cards, charts, overdue by site, recent failures

### Sprints 10–11 (Import + Attachments)
- CSV asset import live with column mapping, preview, and validation
- File attachments live on maintenance checks and test records
- Polymorphic attachment system — easy to extend to other entity types in future

### Sprint 12 (ACB Test Entry)
- ACB Testing module live: create ACB test records linked to assets, with circuit breaker details (make, model, serial)
- Three test types: Initial, Routine, Special
- Readings: add individual measurements with label, value, unit, and pass/fail per reading
- File attachments supported on ACB tests (same as maintenance checks and general test records)
- Dashboard now has ACB Tests stats row alongside maintenance and general test stats
- Sidebar includes ACB Testing link with Shield icon

### Sprint 13 (ACB Reporting)
- ACB DOCX report generation live: per-site report matching Delta Elcom template
- Cover page with site name, year, generated date, white-label tenant branding
- Auto-generated Table of Contents
- Per-breaker sections: header table, CB details (24 attributes), visual/functional checklist (27 items), electrical testing tables, protection test results
- Report download via API route, triggered from ACB Testing list page
- Readings matched to template sections by label (case-insensitive fuzzy match)
- `docx` npm package (docx-js) used for generation

### Sprint 14 (NSX Testing + Reports)
- NSX/MCCB Testing module live: same pattern as ACB but with extra CB fields (rating, poles, trip unit)
- NSX DOCX report generation: per-site report with CB details, 16-item visual/functional checklist, electrical testing, trip test results (4 rows: long time, short time, instantaneous, earth fault)
- Dashboard now has NSX Tests stats row
- Sidebar includes NSX Testing link with CircuitBoard icon
- Report download via API route, triggered from NSX Testing list page

### Sprint 15 (Audit Log, Global Search, Instrument Register)
- Audit log live: immutable audit trail with admin-only viewer, colour-coded action badges, entity/action filters
- `logAuditEvent()` shared action created — silent failure pattern so audit never blocks primary operations
- Global search live: searches 6 entity tables in parallel (assets, sites, customers, ACB tests, NSX tests, instruments), type-specific icons and badges, clickable results
- Instrument register live: full CRUD, calibration tracking with overdue highlighting, 4 statuses (Active/Out for Cal/Retired/Lost), assignee resolution
- Two new migrations applied: 0008_audit_logs.sql, 0009_instruments.sql
- Sidebar updated: Instruments (Wrench icon) and Search (Search icon) in main nav; Audit Log (ScrollText icon) in Admin section

### Sprint 16 (User Management Enhancement)
- `requireAdmin()` updated to accept both super_admin and admin roles (was admin-only)
- Self-demotion guard updated: prevents both super_admin and admin from demoting themselves below admin
- Consistent role hierarchy enforcement across inviteUserAction, setRoleAction, setActiveAction

### Sprint 17 (Deploy & Analytics — Phase 5 Complete)
- Analytics dashboard live: 6 KPI cards, 12-month test volume chart, compliance trend chart, pass rate by test type, instrument calibration status
- Bulk report export live: ZIP download of all ACB + NSX DOCX reports for a site, supervisor+ only
- Archive/soft-delete UX completed across all entity list pages with show_archived toggle and admin reactivate
- 24 performance indexes applied (migration 0010) across all entity tables
- Audit event wiring completed: `logAuditEvent()` now called in every server action across all modules (30+ actions)
- Environment validation: Zod-validated env vars replace raw `process.env!` assertions; app fails fast with clear errors if vars missing
- `.env.example` template committed to repo
- JSZip dependency added for bulk report ZIP generation
- TypeScript fix: search page cast for Supabase foreign key joins
- `tsc --noEmit` → 0 errors. All phases complete.
