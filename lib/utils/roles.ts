import { can, fromServiceRole, type EqRole, type PermKey } from '@eq-solutions/roles'
import type { Role } from '@/lib/types'

// ── Canonical role model (Sprint C6) ───────────────────────────────────
//
// EQ Service no longer hand-rolls its permission matrix. The 5 Service
// roles map onto the canonical @eq-solutions/roles vocabulary via the
// package's `fromServiceRole` adapter, and every gate below is decided by
// the canonical `can()` matrix:
//
//   super_admin → manager      admin     → manager
//   supervisor  → supervisor   technician → employee   read_only → apprentice
//
// TENANT-ISOLATION INVARIANT (enforced in the package, restated here):
// no Service role maps to is_platform_admin. super_admin is a TENANT-SCOPED
// manager, never cross-tenant. Cross-tenant power lives out-of-band
// (service-role / EQ_PLATFORM_ADMIN_KEY), never in a tenant-held role.
//
// The predicate signatures are unchanged so existing call sites are
// untouched; only their decision source moved to the canonical matrix.
// `tests/lib/utils/roles.test.ts` pins the before/after booleans so this
// refactor is provably behaviour-preserving (except the deliberate
// super_admin↔admin collapse — both are `manager`).

/** Map a Service tenant role to its canonical EqRole, or null if absent/unknown. */
export function toEqRole(role: Role | null): EqRole | null {
  return role ? fromServiceRole(role) : null
}

/** Canonical permission check for a Service role. Unknown/absent role ⇒ false. */
export function serviceCan(role: Role | null, perm: PermKey): boolean {
  const eq = toEqRole(role)
  return eq ? can(eq, perm) : false
}

// Admin-style operations: user management, settings, customers/sites/assets
// CRUD, commercial sheets. `admin.list_users` is manager-only, so this is
// true for {super_admin, admin} — identical to the old ADMIN_ROLES set.
export function isAdmin(role: Role | null): boolean {
  return serviceCan(role, 'admin.list_users')
}

// The broad write surface (supervisor-or-above). `service.create`
// ("Raise work orders") is held by manager + supervisor, so this is true
// for {super_admin, admin, supervisor} — identical to the old WRITE_ROLES.
export function canWrite(role: Role | null): boolean {
  return serviceCan(role, 'service.create')
}

// Allowance for spinning up a maintenance_check on-site (migration 0080)
// AND for on-site test execution — saving ACB/NSX wizard steps, editing
// RCD circuit timings, marking a test complete (RLS migrations 0069/0081).
// Both deliberately include 'technician', broader than canWrite().
//
// The canonical `service.create` is supervisor+ (employees can't raise work
// orders in the shared model), but EQ Service intentionally lets technicians
// run a check / do test work on-site. We preserve that one explicit
// extension: manager+supervisor via the matrix, plus employee (= technician).
// Result set {super_admin, admin, supervisor, technician} matches the old
// CHECK_CREATOR_ROLES exactly.
function canCheckOrTest(role: Role | null): boolean {
  const eq = toEqRole(role)
  return eq ? can(eq, 'service.create') || eq === 'employee' : false
}

// Use canCreateCheck for the check-creation path, canDoTestWork for the
// on-site test workflow. Same role set today; kept as two named exports so
// each call site reads its intent. If they ever diverge, both must still
// let technicians through.
export const canCreateCheck = canCheckOrTest
export const canDoTestWork = canCheckOrTest

// ── Inverse adapter: canonical EqRole → Service role ───────────────────
//
// The forward direction (Service → EqRole) is the package's SERVICE_ROLE_MAP /
// fromServiceRole. The Shell↔Service auth bridge (app/api/shell-auth/route.ts)
// needs the INVERSE — minting a Service tenant_members.role from an incoming
// canonical EqRole. That direction is deliberately LOSSY: SERVICE_ROLE_MAP is
// many-to-one (super_admin AND admin both → manager), so coming back from
// `manager` we choose `admin` (super_admin is reserved for the platform-admin
// path, handled by the caller). Co-located here so the whole role vocabulary
// lives in one place; the drift guard (tests/lib/roles-drift.test.ts) pins it
// against the canonical EqRole set.
export const EQ_TO_SERVICE_ROLE: Record<EqRole, Role> = {
  manager: 'admin',
  supervisor: 'supervisor',
  employee: 'technician',
  apprentice: 'read_only',
  labour_hire: 'read_only',
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
