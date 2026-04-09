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

## ACB Testing Module

3-step workflow for Air Circuit Breakers:
1. **Asset Collection** — breaker identification, trip unit, protection settings, accessories
2. **Visual & Functional** — 23-item inspection across 5 sections
3. **Electrical Testing** — contact resistance, IR closed/open, temperature, secondary injection, maintenance completion

Assets filtered by E1.25 job plan (name='E1.25' OR code='LVACB').

@AGENTS.md
