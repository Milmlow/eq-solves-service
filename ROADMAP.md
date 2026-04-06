# EQ Solves — Project Roadmap

> Source of truth for sprint progress. Updated by Cowork at the end of every sprint alongside CHANGELOG.md.
> Last updated: Sprint 17 complete — 06 Apr 2026.

---

## Overall Progress

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1: Foundation | Scaffold, auth, schema, white-label | ✅ Complete |
| Phase 2: Core Data | Customers, sites, assets, job plans | ✅ Complete |
| Phase 3: Workflows | Maintenance, testing, reports, attachments | ✅ Complete |
| Phase 4: Advanced Testing | ACB module, NSX module, instrument register | ✅ Complete |
| Phase 5: Polish & Deploy | Audit trail, search, users, env validation, analytics | ✅ Complete |

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
| 13 | ACB Reporting | Per-breaker ACB test report (DOCX), cover page, TOC, CB details, visual/functional checks, electrical testing, protection results, white-label cover | ✅ Done |
| 14 | NSX Testing + Reports | NSX test CRUD (migration, types, schemas, actions, UI), NSX DOCX report generator, dashboard + sidebar | ✅ Done |

### Phase 5 — Polish & Deploy

| Sprint | Focus | Key Deliverables | Status |
|--------|-------|-----------------|--------|
| 15 | Audit, Search, Instruments | Audit log table + viewer, global search, instrument register CRUD, sidebar polish | ✅ Done |
| 16 | User Management | Enhanced user management (super_admin support), role hierarchy fixes | ✅ Done |
| 17 | Deploy & Analytics | Env validation, performance tuning, analytics dashboard, bulk report export, archive, audit wiring | ✅ Done |

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

---

## Cowork Sprint Handoff Checklist

At the end of every sprint:
1. Update sprint status in this file (⬜ → 🔄 → ✅)
2. Add any new migrations to the table above
3. Append sprint entry to CHANGELOG.md
4. Add any new features to SPEC.md (module section + User Manual Inputs section)
5. Update ARCHITECTURE.md if any structural decisions were made
6. Flag any blocked items for Royce in chat before closing the session
