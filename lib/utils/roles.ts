import { can, type PermKey } from '@eq-solutions/roles'
import type { Role } from '@/lib/types'

// On-site check-creation / test-execution roles: manager, supervisor, employee.
const CHECK_CREATOR_ROLES: Role[] = ['manager', 'supervisor', 'employee']

// ── Canonical permission checks (task C6) ────────────────────────────────
//
// Service's tenant_members.role IS a canonical EqRole (migration 0114), so we
// check it directly against the canonical permission matrix with `can()`. The
// canonical model is the single source of truth across every EQ surface
// (Shell, Field, Service, Cards, Quotes), so authorisation stays consistent
// app-to-app. There is no cross-tenant role: platform power lives only in the
// out-of-band service-role channel, never in a tenant-held role.
function hasPerm(role: Role | null, perm: PermKey): boolean {
  if (!role) return false
  return can(role, perm)
}

// Tenant admin. Canonical `admin.list_users` is manager-only.
export function isAdmin(role: Role | null): boolean {
  return hasPerm(role, 'admin.list_users')
}

// Manager + supervisor. Canonical `service.create` is granted to exactly
// {manager, supervisor}; employee and apprentice are excluded.
export function canWrite(role: Role | null): boolean {
  return hasPerm(role, 'service.create')
}

// Narrow allowance for spinning up a maintenance_check on-site. Mirrors the
// RLS policy "Writers can create checks" (migration 0080 → 0114), which
// includes employee — broader than canWrite() so an on-site employee can
// start an ad-hoc check without flagging down a supervisor. Use this ONLY for
// the check-creation path; other mutations should keep using canWrite().
//
// NOT backed by canonical can(): this gate covers {manager, supervisor,
// employee}, and the canonical matrix has no permission granted to exactly
// that set — `service.create` excludes employee, while `service.view` also
// includes apprentice. This is a Service-local policy (an employee may create
// on-site work) deliberately broader than canonical `service.create`, so it
// stays a string-set predicate rather than a lossy can() mapping.
export function canCreateCheck(role: Role | null): boolean {
  return role !== null && CHECK_CREATOR_ROLES.includes(role)
}

// Allowance for on-site test execution — recording results, saving the
// per-step ACB/NSX wizard state, editing RCD circuit timings, marking a
// test complete. Mirrors the RLS policies on acb_tests / nsx_tests /
// rcd_tests / rcd_test_circuits (migrations 0069 + 0081) which all
// include 'technician' in the writer list. Without this gate the UI
// blocks the tech from saving even though RLS allows it.
//
// Use canDoTestWork for the test workflow itself (the on-site flow).
// Keep canWrite() for admin-style operations: bulk xlsx imports,
// deleting tests, breaker-detail edits, cross-asset operations. Those
// are supervisor-or-above.
export function canDoTestWork(role: Role | null): boolean {
  return role !== null && CHECK_CREATOR_ROLES.includes(role)
}

// NOTE: there is intentionally no `isSuperAdmin` / cross-tenant predicate.
// Cross-tenant power is removed (migration 0114) — genuine EQ-internal
// platform ops run through the out-of-band service-role channel, never a
// tenant-held role. Tenant-admin actions use `isAdmin` (manager).

// ── Import permissions ──────────────────────────────────────────────
//
// Each importer in the app uses a role gate from the helpers above; the
// audit done in /docs/reviews/2026-05-21-import-audit flagged the
// per-flow inconsistency. This block documents the decisions so the
// next reviewer doesn't think they're accidental.
//
//   /testing/acb         importAcbCollectionAction      → canDoTestWork
//   /maintenance/import  commit{,Consolidated}Delta…    → canWrite
//   /testing/rcd/import  commitJemenaRcdImportAction    → canWrite
//   /contract-scope      importScopeItemsAction         → canWrite
//   /commercials/…       commitImportAction (sheet)     → isAdmin
//
// Rationale:
//   * ACB collection round-trips technician-authored data. The same
//     tech can already update one breaker at a time via the workflow
//     UI; offline bulk-fill is an ergonomic shortcut for the same
//     write, so the gate matches (canDoTestWork = supervisor + tech).
//   * Delta WO + RCD imports create or replace many maintenance
//     checks across assets and sites — a supervisor-or-above call
//     because it shapes the team's work, not just one breaker.
//   * Commercial-sheet is wipe-and-replace at the customer-FY level
//     and pivots multi-year cost numbers. Admin-only — the audit-log
//     pre-wipe snapshot is the recovery path if it goes sideways.
