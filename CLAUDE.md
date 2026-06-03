# EQ Solves Service

Multi-tenant maintenance management platform for electrical contractors — circuit breaker testing, maintenance checks, defect tracking, and reporting.

## Project Details

- **Local path**: `C:\Projects\eq-solves-service`
- **Git repo**: https://github.com/Milmlow/eq-solves-service.git
- **Supabase project ID**: `urjhmkhbgaxrofurpbgc`
- **Deployment**: Netlify (auto-deploy from main branch)
- **Framework**: Next.js 16 + React 19 + Supabase + Tailwind CSS 4

## Key Patterns

### Database (Supabase)
- Row-Level Security via `public.get_user_tenant_ids()` and `public.get_user_role(tenant_id)` — all tables enforce tenant isolation
- Trigger function `public.set_updated_at()` auto-maintains `updated_at` timestamps
- Migrations in `supabase/migrations/` — the directory itself is the source of truth (numeric counts here bit-rot fast)
- Storage buckets: `attachments` (general files), `logos` (tenant + customer logos, public bucket with auth RLS)

### Auth & Roles
- `auth.uid()` resolves the current user via Supabase Auth
- `tenant_members` table maps users → tenants with roles: `super_admin`, `admin`, `supervisor`, `technician`, `read_only`
- App-layer role checks via `canWrite(role)` and `isAdmin(role)` from `lib/utils/roles`
- **Tenant assignment on signup:** The `handle_new_user()` trigger (migration 0053) creates a `profiles` row only — it never assigns `tenant_members`. Tenant membership is assigned by the `inviteUserAction` server action, or auto-assigned via `tenant_settings.default_tenant_for_new_users` if configured (migration 0046). Users without a `tenant_members` row hit a clear "No tenant assigned" screen in `app/(app)/layout.tsx` (no silent fallthrough to demo tenant). The `/admin/users` page surfaces orphaned users with an Attach button (`repairUserTenantAction`).
- **MFA history (regression watch):** MFA was historically unstable — an AAL1 challenge loop between signin and `/auth/mfa` was fixed 2026-04-26 by adding `/auth/signin` to `AAL_EXEMPT_PATHS` in `proxy.ts` so users with stale AAL1+TOTP sessions can sign out and start fresh. PostHog `mfa_redirect` events are emitted on every AAL gate bounce so any recurrence is visible (two redirects within ~30s for the same user = suspected loop). Re-verify on any auth-related change.
- **Tenant IDs:** SKS = `ccca00fc-cbc8-442e-9489-0f1f216ddca8`, Demo = `a0000000-0000-0000-0000-000000000001`

### Server Actions
- All mutations use Next.js server actions in `app/(app)/*/actions.ts`
- Pattern: `requireUser()` → role check → Zod validation → Supabase mutation → audit log → `revalidatePath()`

### UI
- Custom component library in `components/ui/` (no shadcn) — uses Tailwind tokens: `eq-sky`, `eq-deep`, `eq-ice`, `eq-ink`, `eq-grey`
- Client components use `createClient()` from `lib/supabase/client`
- `SearchFilter` component uses URL params for server-side filtering

### UI conventions (canonical — follow on new surfaces; per-PR cosmetic detail in `docs/HISTORY.md`)
- **StatusBadge** (`components/ui/StatusBadge.tsx`) is the canonical status pill (tone soft/solid, size sm/md, leading dot). Replace inline `<span>` pills with hard-coded `bg-*-50 text-*-700` as you find them.
- **KindPill** colours: PPM=sky, ACB=purple, NSX=indigo, RCD=amber, General=gray.
- **Sidebar** (`components/ui/Sidebar.tsx`) — items in `navSections` (Data / Operations / Insight + Dashboard, Search/Settings groups); active item gets a left accent strip via `before:`.

## Maintenance Checks (unified model — 2026-04-28)

There is **one** "check" concept across the whole app. A `maintenance_checks` row carries a `kind` discriminator that decides what the row is for:

```
maintenance_checks
  ├─ kind = 'maintenance'  ← standard PPM (the original use)
  ├─ kind = 'acb'          ← was testing_checks.check_type='acb'
  ├─ kind = 'nsx'          ← was testing_checks.check_type='nsx'
  ├─ kind = 'rcd'          ← RCD testing
  └─ kind = 'general'      ← legacy general testing
```

Migration 0080 collapsed the parallel `testing_checks` table into `maintenance_checks` with the same UUIDs. Migration 0081 renamed `acb_tests.testing_check_id` and `nsx_tests.testing_check_id` to `check_id` so all three test types use the same column name.

**Linkage:**
```
acb_tests.check_id  → maintenance_checks(id)
nsx_tests.check_id  → maintenance_checks(id)
rcd_tests.check_id  → maintenance_checks(id)
```

**RLS — who can create checks:** super_admin / admin / supervisor / **technician** (loosened in migration 0080 so technicians can spin up a check on-site). At the app layer this is gated by `canCreateCheck()` from `lib/utils/roles`, NOT `canWrite()` — `canWrite()` deliberately excludes technician so the broader CRUD surface (customers, sites, job plans, etc.) stays supervisor+. Only `createCheckAction` opens the door to technicians.

**Mark Complete propagation:** the shared helper `propagateCheckCompletionIfReady(supabase, checkId)` in `lib/actions/check-completion.ts` flips the parent `maintenance_check` to `complete + completed_at = now()` only when **every** linked test (acb + nsx + rcd) is in its complete state. Wired into the ACB step-3 save, NSX step-3 save, and RCD header save. Idempotent — never clobbers an already-complete parent.

**Items unlock after Complete All.** `updateCheckItemAction` accepts both `in_progress` AND `complete` parent statuses so the tech can bulk-pass via Complete All Assets first, then downgrade specific failures. Audit log captures every flip. `scheduled` and `cancelled` remain blocked.

**"Complete All Assets" button is PPM-only.** Bulk-marks `check_assets` as completed — only meaningful for kind=maintenance checks. Hidden on kind=acb/nsx/rcd (test workflows aren't bulk-passable; each runs its own 3-step workflow).

> A read-only `testing_checks` view (`maintenance_checks WHERE kind IN ('acb','nsx','general')`, security_invoker) existed during the transition and was dropped in migration 0086 — see `docs/HISTORY.md`.

## Reference (load on demand)

- **Module specs** — routes, workflows, toolbars, report formats — live in **`docs/FEATURES.md`** (Testing nav, ACB/NSX, Testing Summary, Reports & Run-Sheet + Report Settings, Job Plans, Contract Scope, Calendar, Assets, Maintenance Import). Read the relevant section before working on a module.
- **Customer configs** (job plans, RCD workflow, site/asset data) → **`docs/customers/`** (e.g. `docs/customers/jemena.md`).
- **Dated PR / decision narrative** → **`docs/HISTORY.md`** (+ git).

## Conventions
- `requireUser()` at the top of every server action — resolves user, tenant, role
- `tsc --noEmit` at 0 errors before any sprint is closed
- **Run `npm run check` before pushing to main.** Equivalent to `tsc --noEmit && next build`. Catches both TypeScript errors and Turbopack bundler rules (e.g. `react-dom/server` imports in app routes).
- No credentials hardcoded — `.env.local` only, never committed
- No deployment without explicit Royce instruction in chat
- Working before refactoring
- Auth changes → flag to chat before acting
- All mutations use Next.js server actions: `requireUser()` → role check → Zod validation → Supabase mutation → audit log → `revalidatePath()`
- Zod v4: use `.error.issues[0]` not `.errors[0]`; use `error:` option not `errorMap:`
- Client components use `createClient()` from `lib/supabase/client`; server components/actions use `lib/supabase/server`
- Soft deletes via `is_active` everywhere — no hard deletes (except consumed MFA codes, removed job plan items, **and the `defects` table which uses `status` (open/resolved) + `resolved_at` instead — do not add `is_active` to defects queries, it doesn't exist**)
- All DataTable instances use `onRowClick` — no icon action columns
- Toolbar button order convention: Import (left), Export, then action buttons (right)
- Button labels: "Import" and "Export" — never "Import CSV" or "Export CSV"

@AGENTS.md
