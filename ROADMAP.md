# EQ Solves — Project Roadmap

> Source of truth for sprint progress. Updated by Cowork at the end of every sprint alongside CHANGELOG.md.
> Last updated: Sprint 22 complete — 08 Apr 2026.

---

## Overall Progress

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1: Foundation | Scaffold, auth, schema, white-label | ✅ Complete |
| Phase 2: Core Data | Customers, sites, assets, job plans | ✅ Complete |
| Phase 3: Workflows | Maintenance, testing, reports, attachments | ✅ Complete |
| Phase 4: Advanced Testing | ACB module, NSX module, instrument register | ✅ Complete |
| Phase 5: Polish & Deploy | Audit trail, search, users, env validation, analytics | ✅ Complete |
| Phase 6: Data Onboarding | Universal CSV import for all entity types | ✅ Complete |
| Phase 7: Operational Maturity | Site detail, batch checks, PM reports, Kanban, notifications, tests | ✅ Complete |
| Phase 8: Maximo Integration | IBM Maximo data model alignment, check-to-asset junction, full-page check detail | ✅ Complete |

---

## Sprint Detail

### Phase 1 — Foundation

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 1 | Scaffold & Design System | Next.js 16, Tailwind v4, EQ design tokens, Supabase clients, component library (Button, Card, DataTable, Modal, SlidePanel, StatusBadge, Sidebar, Breadcrumb), placeholder pages, health check API | ✅ Done |
| 2 | Auth & User Management | Email/password auth, MFA (TOTP + recovery codes), RBAC (super_admin/admin/supervisor/technician/read_only), route guards, admin user management, invite flow, Resend SMTP | ✅ Done |
| 3 | Core Schema, API & White-Label | Migration 0002 (8 tables), full CRUD API layer (12 routes), Zod validation, TypeScript types, white-label CSS var engine, tenant settings, seed data | ✅ Done |

### Phase 2 — Core Data

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 4 | Customers & Sites UI | Customer list/form/CRUD, site list/form/CRUD, live dashboard counts, Pagination + SearchFilter components | ✅ Done |
| 5 | Asset Register UI | Asset list, asset detail panel, asset create/edit form, protection settings, site/type filters | ✅ Done |
| 6 | Job Plans & Tenant Settings | Job plan CRUD, inline item management, frequency flags, tenant settings editor (colour pickers, product name), format/role utilities | ✅ Done |

### Phase 3 — Workflows

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 7 | Maintenance Checks | Migration 0003, check CRUD, technician workflow (pass/fail/na per item), start/complete/cancel, dashboard maintenance stats | ✅ Done |
| 8+9 | Testing Module & Compliance Reports | Migration 0004, test records CRUD, readings management, compliance report page (KPIs, charts, overdue by site, recent failures), dashboard test stats | ✅ Done |
| 10+11 | CSV Import & File Attachments | Migration 0005, polymorphic attachments table + Supabase Storage bucket, AttachmentList component, attachments on checks + test records, CSV asset import with column mapping/preview/validation | ✅ Done |

### Phase 4 — Advanced Testing

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 12 | ACB Test Entry | Migration 0006, ACB test list/form/detail, readings management, dashboard ACB stats, sidebar nav | ✅ Done |
| 13 | ACB Reporting | Per-breaker ACB test report (DOCX ~6 pages/breaker), cover page, TOC, CB details table, visual/functional checklist (26+ items), electrical testing (contact resistance, insulation resistance), protection results, white-label cover. Page count scales with breakers tested. | ✅ Done |
| 14 | NSX Testing + Reports | NSX test CRUD (migration, types, schemas, actions, UI), NSX DOCX report generator, dashboard + sidebar | ✅ Done |

### Phase 5 — Polish & Deploy

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 15 | Audit, Search, Instruments | Audit log table + viewer, global search, instrument register CRUD, sidebar polish | ✅ Done |
| 16 | User Management | Enhanced user management (super_admin support), role hierarchy fixes | ✅ Done |
| 17 | Deploy & Analytics | Env validation, performance tuning, analytics dashboard, bulk report export, archive, audit wiring | ✅ Done |

### Phase 6 — Data Onboarding

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 18 | Universal CSV Import | Shared CSV parser utility (`lib/utils/csv-parser.ts`), generic `ImportCSVModal` component with column auto-mapping/preview/validation, CSV import for **Customers**, **Sites** (customer name lookup), **Instruments** (status validation), **Job Plans** (site name lookup, frequency validation), refactored Assets import to shared component. Import button on all list pages, 500-row limit, audit logging per import. | ✅ Done |

### Phase 7 — Operational Maturity

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 19 | Site Detail + Batch Checks | `/sites/[id]` unified detail page (stats, recent assets/checks/tests), batch check creation wizard (`batchCreateChecksAction` — frequency-based date scheduling, up to 52 checks/batch, copies job plan items), `BatchCreateForm` with date preview grid | ✅ Done |
| 20 | PM Reports + Kanban | PM check sign-off DOCX report (`/api/pm-report`, cover page, summary table, items checklist with pass/fail/na, stats), download button on completed checks. Kanban board view for maintenance (Scheduled/In Progress/Overdue/Complete columns, progress bars, view toggle Table↔Kanban) | ✅ Done |
| 21 | Notifications + Test Suite | Migration 0011 (notifications table + RLS), notification engine (`createNotification`, `markAsRead`, `markAllRead`), `/api/notifications` route, `NotificationBell` dropdown in sidebar, auto-notify on check assign/complete. Vitest test infrastructure (80 tests): CSV parser, role utils, format utils, Supabase mock, auth action integration tests | ✅ Done |

### Phase 8 — Maximo Integration

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 22 | Maximo Alignment & Check Rebuild | IBM Maximo data model alignment (job plan restructure, per-item frequency flags, check_assets junction table), two-path check creation (auto-frequency + manual Maximo IDs), full-page maintenance check detail with sortable asset table and expandable task rows, paste WO#s from Excel, force-complete per asset, 4,802 asset import, clickable rows across all tables, dark site test support | ✅ Done |

---

## Migrations Applied

| File | Description | Status |
|------|-------------|--------|
| 0001_profiles_and_recovery_codes.sql | Profiles, MFA recovery codes, auth triggers, RLS | ✅ Applied |
| 0002_core_schema.sql | Tenants, customers, sites, assets, job plans, full RLS | ✅ Applied |
| 0003_maintenance_checks_schema.sql | Maintenance checks + items, workflow states | ✅ Applied |
| 0004_test_records_schema.sql | Test records + readings | ✅ Applied |
| 0005_attachments_schema.sql | Polymorphic attachments, Supabase Storage bucket + policies | ✅ Applied |
| 0006_acb_tests_schema.sql | ACB tests + readings | ✅ Applied |
| 0007_nsx_tests_schema.sql | NSX/MCCB tests + readings | ✅ Applied |
| 0008_audit_logs.sql | Immutable audit log, 5 indexes | ✅ Applied |
| 0009_instruments.sql | Instrument register with calibration tracking | ✅ Applied |
| 0010_performance_indexes.sql | 24 indexes on query hotspots | ✅ Applied |
| 0011_notifications.sql | Notifications table, RLS policies, user + entity indexes | ✅ Applied |
| 0012_job_plan_restructure.sql | Job plan code/type columns, per-item frequency boolean flags, is_dark_site | ✅ Applied |
| 0013_maximo_aligned_schema.sql | Asset job_plan_id FK, check_assets junction, maintenance check frequency/custom_name/maximo fields | ✅ Applied |
| 0014_check_assets_work_order.sql | work_order_number on check_assets | ✅ Applied |

---

## Cowork Sprint Handoff Checklist

At the end of every sprint:
1. Update sprint status in this file (⬜ → 🔄 → ✅)
2. Add any new migrations to the table above
3. Append sprint entry to CHANGELOG.md
4. Add any new features to SPEC.md (module section + User Manual Inputs section)
5. Update ARCHITECTURE.md if any structural decisions were made
6. Flag any blocked items for Royce in chat before closing the session
