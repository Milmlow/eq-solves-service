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
- Migrations in `supabase/migrations/` numbered sequentially (0001–0023+)
- Storage buckets: `attachments` (general files), `logos` (tenant + customer logos, public bucket with auth RLS)

### Auth & Roles
- `auth.uid()` resolves the current user via Supabase Auth
- `tenant_members` table maps users → tenants with roles: `super_admin`, `admin`, `supervisor`, `technician`, `read_only`
- App-layer role checks via `canWrite(role)` and `isAdmin(role)` from `lib/utils/roles`

### Server Actions
- All mutations use Next.js server actions in `app/(app)/*/actions.ts`
- Pattern: `requireUser()` → role check → Zod validation → Supabase mutation → audit log → `revalidatePath()`

### UI
- Custom component library in `components/ui/` (no shadcn) — uses Tailwind tokens: `eq-sky`, `eq-deep`, `eq-ice`, `eq-ink`, `eq-grey`
- Client components use `createClient()` from `lib/supabase/client`
- `SearchFilter` component uses URL params for server-side filtering

## ACB Testing Module

3-step workflow for Air Circuit Breakers at `/testing/acb`:
1. **Asset Collection** (Step 1) — breaker identification (brand, type, name/location, serial, performance level N1/H1/H2/H3/L1, protection unit Y/N), trip unit & ratings (model, poles, IN, fixed/withdrawable), protection settings (conditional on protection unit, long time Ir/tr, short time Isd/tsd, instantaneous, earth fault, earth leakage), accessories (motor charge, MX1, XF, MN, MX2 — voltage dropdowns)
2. **Visual & Functional** (Step 2) — 23-item inspection across 5 sections: Visual Inspection (4), Service Operations (3), Functional Tests Chassis (3 incl numeric op counter), Functional Tests Device (11), Auxiliaries (2). Each item OK/Not OK/N/A with comment on failure.
3. **Electrical Testing** (Step 3) — contact resistance R/W/B in µΩ with 30% variance warning, IR closed (7 combos in MΩ), IR open (4 in MΩ), temperature °C, secondary injection check, maintenance completion (greasing, op counter, racking)

Assets filtered by E1.25 job plan (global plan — `name='E1.25'` OR `code='LVACB'`, `site_id` is null). Default tab is Visual & Functional (Step 2).

Excel batch fill: export pre-populated .xlsx per site, fill offline, import back to batch-update all collection data.

Site-level Asset Collection view: expandable cards per CB with all collection fields.

## NSX Testing Module

3-step workflow framework at `/testing/nsx` mirroring ACB. Site-based asset loading filtered by NSX / MCCB job plan (name containing 'NSX' or code `LVNSX`/`MCCB`), falls back to all site assets if no matching plan. Step 1 Asset Collection is a full form (brand, breaker type, serial, current In, trip unit model, poles, fixed/withdrawable/plug_in, protection settings); Steps 2 & 3 are scaffolded placeholders pending field-set finalisation. State via `step1/2/3_status` columns on `nsx_tests` (migration 0026).

## Testing Summary

`/testing/summary` — combined register of ACB, NSX and General test records with site / kind / status / date filters, KPI cards and progress bars. Used for tracking work-in-progress tests across all three modules.

## Reports

`/reports` — compliance dashboard with maintenance compliance rate, overdue checks, test pass rate, ACB & NSX workflow progress, defects register summary (status + severity), maintenance compliance by site (top 10) and a 6-month trend chart (tests run vs maintenance checks due).

## Job Plans
- Job plans may be global (`site_id = null`) or site-specific
- Columns: code (Job Code), name (Job Plan e.g. E1.25), type (descriptive Name e.g. "Low Voltage Air Circuit Breaker")
- Assets link via `assets.job_plan_id` → `job_plans.id`

## Assets Page
- Filterable by site and job plan (dropdown shows `name - type` e.g. "E1.25 - Low Voltage Air Circuit Breaker")
- Grouped view and table view with site-based grouping

## Conventions
- `requireUser()` at the top of every server action — resolves user, tenant, role
- `tsc --noEmit` at 0 errors before any sprint is closed
- No credentials hardcoded — `.env.local` only, never committed
- No deployment without explicit Royce instruction in chat
- Working before refactoring
- Auth changes → flag to chat before acting
- All mutations use Next.js server actions: `requireUser()` → role check → Zod validation → Supabase mutation → audit log → `revalidatePath()`
- Zod v4: use `.error.issues[0]` not `.errors[0]`; use `error:` option not `errorMap:`
- Client components use `createClient()` from `lib/supabase/client`; server components/actions use `lib/supabase/server`
- Soft deletes via `is_active` everywhere — no hard deletes (except consumed MFA codes and removed job plan items)
- All DataTable instances use `onRowClick` — no icon action columns

@AGENTS.md
