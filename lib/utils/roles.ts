import { can, fromServiceRole, type PermKey } from '@eq-solutions/roles'
import type { Role } from '@/lib/types'

const CHECK_CREATOR_ROLES: Role[] = ['super_admin', 'admin', 'supervisor', 'technician']

// ── Canonical permission bridge (task C6, 2026-06-04) ────────────────────
//
// Service's tenant_members.role is mapped onto the canonical EqRole via
// `fromServiceRole()` (from @eq-solutions/roles), then checked against the
// canonical permission matrix with `can()`. The canonical model is the
// single source of truth across every EQ surface (Shell, Field, Service,
// Cards, Quotes), so authorisation decisions stay consistent app-to-app.
//
// Mapping (SERVICE_ROLE_MAP): super_admin/admin → manager, supervisor →
// supervisor, technician → employee, read_only → apprentice. No Service
// role maps to is_platform_admin — cross-tenant power is never derived from
// a tenant-held role, so tenants stay isolated.
function hasPerm(role: Role | null, perm: PermKey): boolean {
  if (!role) return false
  const eqRole = fromServiceRole(role)
  return eqRole !== null && can(eqRole, perm)
}

// super_admin / admin only. Canonical `admin.list_users` is manager-only,
// and both super_admin and admin map to manager — a clean 1:1 with the
// previous ['super_admin','admin'] check.
export function isAdmin(role: Role | null): boolean {
  return hasPerm(role, 'admin.list_users')
}

// super_admin / admin / supervisor. Canonical `service.create` is granted to
// exactly {manager, supervisor}; technician (→ employee) and read_only
// (→ apprentice) are excluded — a clean 1:1 with the previous
// ['super_admin','admin','supervisor'] check.
export function canWrite(role: Role | null): boolean {
  return hasPerm(role, 'service.create')
}

// Narrow allowance for spinning up a maintenance_check on-site. Mirrors the
// RLS policy "Writers can create checks" from migration 0080, which includes
// technician — broader than canWrite() so a tech can start an ad-hoc check
// without flagging down a supervisor. Use this ONLY for the check-creation
// path; other mutations should keep using canWrite().
//
// NOT backed by canonical can() (C6): this gate covers {super_admin, admin,
// supervisor, technician} = {manager, supervisor, employee}, and the
// canonical matrix has no permission granted to exactly that set —
// `service.create` excludes employee, while `service.view` also includes
// apprentice. This is a Service-local policy (a tech may create on-site work)
// that's deliberately broader than canonical `service.create`, so it stays a
// string-set predicate rather than a lossy can() mapping.
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

export function isSuperAdmin(role: Role | null): boolean {
  return role === 'super_admin'
}

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
