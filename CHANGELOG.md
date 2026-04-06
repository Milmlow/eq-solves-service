# CHANGELOG — EQ Solves Service

All notable changes to this project are logged here. Appended by Cowork at the end of every session.

---

## [Sprint 4] 2026-04-06 — Customers & Sites CRUD UI

### Added
- **Customers list page** (`app/(app)/customers/page.tsx`) — server-side data fetching, search (name/code/email), pagination (25/page), DataTable with status badges, SlidePanel create/edit forms, deactivate/reactivate (admin+)
- **Customer form** (`CustomerForm.tsx`) — name, code, email, phone, address fields. Edit mode shows "Sites" quick-link to filtered sites view
- **Sites list page** — replaced placeholder. Server-side fetch with joined customer name and asset count column. Customer dropdown filter, search, pagination. Clickable asset count navigates to `/assets?site_id=xxx`
- **Site form** (`SiteForm.tsx`) — name, code, customer dropdown, address, city, state, postcode, country (default Australia). Deactivate/reactivate for admin+
- **Customers nav item** — added to Sidebar between Dashboard and Sites, using `Building2` icon
- **Dashboard** — replaced hardcoded stats with live counts (customers, sites, assets, job plans) fetched from Supabase. Clickable cards link to respective list pages
- **Server actions** for customers and sites — `createCustomerAction`, `updateCustomerAction`, `toggleCustomerActiveAction`, `createSiteAction`, `updateSiteAction`, `toggleSiteActiveAction`

### Verified
- `npx next build` → 26 routes compiled, 0 TypeScript errors
- Seed data renders correctly (Equinix, Schneider customers; SY1, SY4, MEL1 sites)

---

## [Sprint 5] 2026-04-06 — Asset Register UI

### Added
- **Assets list page** — replaced placeholder. Server-side fetch with joined site name. Filter bar: site dropdown + asset type dropdown + search (name/type/serial/maximo). Pagination
- **Asset type filter** — dynamically fetches distinct `asset_type` values from the assets table
- **Asset form** (`AssetForm.tsx`) — grouped sections (Identification, Location, Details). Site dropdown (required), date picker for install date. Admin section for deactivate/reactivate
- **Asset detail view** — read-only detail panel with all fields displayed, "Edit" button to switch to form mode, "Job Plans" section showing plans linked to the asset's site
- **Import placeholder** — disabled "Import" button with "Coming soon — CSV import" tooltip
- **Server actions** — `createAssetAction` (supervisor+), `updateAssetAction` (supervisor+), `toggleAssetActiveAction` (admin+)

---

## [Sprint 6] 2026-04-06 — Job Plans UI & Tenant Settings

### Added
- **Job Plans list page** (`app/(app)/job-plans/page.tsx`) — server-side fetch with joined site name and item count. Filter bar: site dropdown + frequency dropdown + search. Pagination
- **Job Plan form** (`JobPlanForm.tsx`) — name, site dropdown, description textarea, frequency dropdown (Weekly/Monthly/Quarterly/Bi-annual/Annual/Ad Hoc). Deactivate/reactivate for admin+
- **Job Plan Items** — inline task management below job plan form. Add/edit/delete individual items with description, sort order, required flag. Hard delete for items
- **Job Plans nav item** — added to Sidebar between Assets and Maintenance, using `FileCheck` icon
- **Tenant Settings editor** — replaced placeholder with full editing form. Branding section: product name, 4 colour pickers with live hex display and preview strip. Contact section: support email. Logo URL input (file upload deferred). Saves via server action, updates CSS vars on next page load
- **Format helpers** (`lib/utils/format.ts`) — `formatFrequency()`, `formatDate()` (DD MMM YYYY), `formatDateTime()` (DD MMM YYYY, HH:mm)
- **Role utilities** (`lib/utils/roles.ts`) — `isAdmin()`, `canWrite()`, `isSuperAdmin()` extracted from server action context
- **Server action auth** (`lib/actions/auth.ts`) — `requireUser()` resolves authenticated user + tenant + role for server actions

### Shared Components Added
- **Pagination** (`components/ui/Pagination.tsx`) — Page X of Y with Previous/Next, URL-based via searchParams
- **SearchFilter** (`components/ui/SearchFilter.tsx`) — reusable search input + dropdown filters, URL-based
- **StatusBadge** extended with `active`/`inactive` variants (green/grey)

### Fixed
- **Zod error access** — changed `.error.errors[0]` to `.error.issues[0]` across all server actions (correct Zod v3 API)

### Files Created
- `app/(app)/customers/{page,CustomerList,CustomerForm,actions}.tsx`
- `app/(app)/sites/{SiteList,SiteForm,actions}.tsx`
- `app/(app)/assets/{AssetList,AssetForm,actions}.tsx`
- `app/(app)/job-plans/{page,JobPlanList,JobPlanForm,actions}.tsx`
- `app/(app)/admin/settings/{TenantSettingsForm,actions}.tsx`
- `lib/actions/auth.ts`, `lib/utils/roles.ts`, `lib/utils/format.ts`
- `components/ui/{Pagination,SearchFilter}.tsx`

### Files Modified
- `components/ui/Sidebar.tsx` — added Customers + Job Plans nav items
- `components/ui/StatusBadge.tsx` — added active/inactive variants
- `app/(app)/dashboard/page.tsx` — live counts from Supabase
- `app/(app)/sites/page.tsx` — full CRUD replacing placeholder
- `app/(app)/assets/page.tsx` — full CRUD replacing placeholder
- `app/(app)/admin/settings/page.tsx` — full editor replacing placeholder

---

## [Sprint 3] 2026-04-06 — Core Schema, API Layer, White-Label Engine, Expanded Roles

### Added
- **Migration `0002_core_schema.sql`** — 8 new tables: `tenants`, `tenant_settings`, `tenant_members`, `customers`, `sites`, `assets`, `job_plans`, `job_plan_items`. Full RLS on every table, `updated_at` triggers, indexes.
- **Helper functions**: `get_user_tenant_ids()`, `is_super_admin()`, `get_user_role(tenant_id)`, `is_tenant_admin(tenant_id)` — all SECURITY DEFINER with explicit search_path.
- **Expanded roles**: profiles constraint updated to support `super_admin`, `admin`, `supervisor`, `technician`, `read_only`, `user`. Invite form and users table updated with all 5 roles.
- **TypeScript types** (`lib/types/index.ts`): `Tenant`, `TenantSettings`, `TenantMember`, `Profile`, `Customer`, `Site`, `Asset`, `JobPlan`, `JobPlanItem`, `ApiResponse<T>`, `PaginationMeta`, `Role`, `Frequency`.
- **Zod validation schemas** (`lib/validations/`): `tenant.ts`, `customer.ts`, `site.ts`, `asset.ts`, `job-plan.ts` — create + update schemas for all entities.
- **API helpers** (`lib/api/`): `response.ts` (ok, created, err, unauthorized, forbidden, notFound), `pagination.ts` (parsePagination, paginationMeta), `auth.ts` (getApiUser, isAdmin, canWrite, isSuperAdmin).
- **CRUD API routes**: tenants (super_admin only), customers, sites (filter by customer_id), assets (filter by site_id), job-plans (filter by site_id), job-plan-items — all with Zod validation, pagination, role-based access, soft deletes. 12 route files total.
- **White-label engine**: `lib/tenant/getTenantSettings.ts` resolves tenant settings for current user. `app/(app)/layout.tsx` injects `--eq-sky`, `--eq-deep`, `--eq-ice`, `--eq-ink` CSS vars from `tenant_settings` — changing colours in DB changes the app without redeploy. `TenantLogo` component renders logo image or text fallback.
- **Sidebar**: now uses `TenantLogo` + `product_name` from tenant settings. Added "Tenant Settings" admin link.
- **Auth layout**: uses `TenantLogo` component for branded auth screens.
- **`/admin/settings`**: placeholder page showing current tenant settings (colours, product name, logo status). Editing deferred to Sprint 4.
- **Seed data**: SKS Technologies tenant with settings, 2 customers (Equinix, Schneider), 3 sites (SY1, SY4, MEL1), 5 assets (ACB, NSX, Switchboard, ATS), 1 job plan with 3 items. Both existing admin users linked as `super_admin`.
- **Installed**: `zod` for schema validation.

### Verified
- `npx next build` → 31 routes compiled, 0 TypeScript errors
- Migration applied to `urjhmkhbgaxrofurpbgc`, security advisors clean
- Seed data visible in Supabase dashboard

### Decisions Made
- **Tables before functions** in migration — Postgres requires referenced tables to exist when creating SECURITY DEFINER functions with inline SQL.
- **Tenant resolution**: single-tenant per user for now (first active `tenant_members` row). Multi-tenant user support (switching tenants) deferred.
- **Admin route guard**: updated to check `tenant_members.role` for `super_admin` or `admin`, replacing `profiles.role` check.
- **Soft deletes via `is_active`**: consistent across all entities, per TECH_SPEC.
- **Pagination**: default 25/page, max 100, using Supabase `.range()`.

### Files Touched
- Created: `supabase/migrations/0002_core_schema.sql`, `lib/types/index.ts` (rewritten), `lib/api/{response,pagination,auth}.ts`, `lib/validations/{tenant,customer,site,asset,job-plan}.ts`, `lib/tenant/getTenantSettings.ts`, `components/ui/TenantLogo.tsx`, `app/api/{tenants,customers,sites,assets,job-plans}/**/*.ts` (12 route files), `app/(app)/admin/settings/page.tsx`
- Modified: `app/(app)/layout.tsx` (tenant CSS vars + settings prop), `app/(auth)/layout.tsx` (TenantLogo), `components/ui/Sidebar.tsx` (TenantLogo, settings prop, admin settings link, expanded roles), `app/(app)/admin/users/{InviteUserForm,UsersTable,actions}.tsx` (5 roles)
- Installed: `zod`

---

## [Sprint 2] 2026-04-05 — Auth, MFA & User Management

### Added
- DB migration `0001_profiles_and_recovery_codes.sql` — `profiles` table (role-based: admin/user, is_active soft-delete, last_login_at), `mfa_recovery_codes` table, `handle_new_user()` trigger (auto-creates profile, seeds admin role for `dev@eq.solutions`), `is_admin()` SECURITY DEFINER helper, `set_updated_at()` trigger, full RLS policies (users see/update own, admins see/update all, users cannot change their own role)
- `lib/supabase/admin.ts` — service-role client for server-only admin operations (invites, recovery code writes)
- `lib/supabase/middleware.ts` — `updateSession()` helper that refreshes cookies and returns user + AAL level
- `proxy.ts` (Next 16 — replaces middleware.ts) — session refresh on every request, AAL1→AAL2 enforcement, admin route guard, deactivated-user signout, auto-redirect authed users away from public auth pages
- `/auth/signin` — email+password form via server action, updates `last_login_at` on success
- `/auth/forgot-password` + `/auth/reset-password` — Supabase email reset flow
- `/auth/callback` — exchanges reset/invite email codes for session
- `/auth/enroll-mfa` — TOTP QR code (Google/Microsoft Authenticator), verify, generates 8 bcrypt-hashed recovery codes (`XXXXX-XXXXX` format) shown once with download option
- `/auth/mfa` — challenge page with TOTP 6-digit code + recovery-code fallback (consumes code, unenrols factor, forces re-enrolment)
- `/auth/signout` — POST/GET route, wired from sidebar
- `/admin/users` — admin-only page: list all users, invite by email (sends Supabase invite with `reset-password` redirect, assigns role), toggle active, change role (cannot self-deactivate or self-demote)
- Sidebar: admin section with Users link (only when `isAdmin`), active-route highlighting, signout button at bottom, converted to `next/link`

### Removed
- Old `/app/(auth)/login/page.tsx` placeholder

### Verified
- `npx next build` passes — 19 routes, 0 TypeScript errors, proxy compiled
- Migration applied to project `urjhmkhbgaxrofurpbgc`, security advisors clean (search_path fixed on `set_updated_at`)

### Decisions Made
- **`proxy.ts` (not `middleware.ts`)** — Next.js 16 renamed middleware to proxy with `proxy()` export. Idiomatic v16 pattern, not flagged as a deviation.
- **Custom recovery codes** — Supabase has no built-in recovery code API for TOTP; implemented bcrypt-hashed storage in `mfa_recovery_codes` with RLS (users read own, service-role writes).
- **Service role for admin ops** — user invites, recovery code inserts, and admin user mutations go via `createAdminClient()` to bypass RLS. Key is server-side only.
- **Admin bootstrap** — `handle_new_user()` trigger seeds admin role for emails in hardcoded array (`dev@eq.solutions`). First admin is created by signing up with that email.
- Password minimum length: 10 chars (on reset).

### Fixed During Testing (same session)
- **QR code rendering** — Supabase returns `totp.qr_code` as a `data:image/svg+xml` data URL, not raw SVG. Changed `dangerouslySetInnerHTML` to `<img src={qrCode}>` so authenticator apps can scan it.
- **Stale MFA factor hang** — `enrollStartAction()` failed silently if an unverified factor existed from a previous aborted enrolment. Now cleans up unverified factors before enrolling + catches errors in client.
- **Password reset AAL2 block** — Supabase blocks `updateUser({password})` at AAL1 when MFA is enrolled. Recovery email only grants AAL1. Fixed by using `admin.auth.admin.updateUserById()` (service-role) — email ownership already proven by recovery link. Signs user out after update.
- **Forgot-password redirect path** — `redirectTo` was pointing directly at `/auth/reset-password`, skipping code exchange. Changed to `/auth/callback?next=/auth/reset-password` so the callback handler exchanges the code first.
- **AAL-exempt paths** — `proxy.ts` was forcing MFA challenge before `/auth/reset-password` and `/auth/signout`. Added `AAL_EXEMPT_PATHS` array to allow these without AAL2.
- **Resend SMTP configured** — Supabase default SMTP rate-limited at 2 emails/hour. Custom SMTP (Resend) configured in Supabase dashboard. Invite emails now deliver.

### Blocked / Flagged for Chat
- **MFA is enforced on all app routes.** Any authenticated user without a TOTP factor is forced to `/auth/enroll-mfa` before accessing any page. If you need to bypass this temporarily for dev/testing, flag to Chat.
- **Roles currently limited to `admin` and `user`.** TECH_SPEC defines Supervisor, Technician, Read-Only, and Super Admin — these need to be added in a future sprint when the corresponding features require them.

### Files Touched
- Created: `supabase/migrations/0001_profiles_and_recovery_codes.sql`, `lib/supabase/admin.ts`, `lib/supabase/middleware.ts`, `proxy.ts`, `app/(auth)/auth/{signin,forgot-password,reset-password,enroll-mfa,mfa,callback}/*`, `app/auth/signout/route.ts`, `app/(app)/admin/users/{page,actions,InviteUserForm,UsersTable}.tsx`
- Modified: `components/ui/Sidebar.tsx` (admin link, signout, active state), `app/(app)/layout.tsx` (fetches isAdmin), `app/(auth)/layout.tsx` (EQ branded auth shell)
- Removed: `app/(auth)/login/page.tsx`
- Installed: `bcryptjs@^3.0.3`

---

## [Sprint 1] 2026-04-05 — Next.js scaffold and EQ design system

### Added
- Next.js 16 App Router project with TypeScript strict mode and Tailwind CSS v4
- EQ design tokens (eq-sky, eq-deep, eq-ice, eq-ink, eq-grey) exposed via Tailwind v4 `@theme` directive in `app/globals.css`
- Plus Jakarta Sans typography via Google Fonts
- Supabase browser and server clients (`lib/supabase/client.ts`, `lib/supabase/server.ts`) using `@supabase/ssr`
- `cn()` utility (`lib/utils/cn.ts`)
- UI components: Button, Card, StatusBadge, FormInput, DataTable, Modal, SlidePanel, Sidebar, Breadcrumb
- App group layout with collapsible sidebar (`app/(app)/layout.tsx`)
- Dashboard placeholder with stat cards and status badge (`app/(app)/dashboard/page.tsx`)
- Placeholder pages: sites, assets, maintenance, testing, reports, settings, login
- Root redirect `/` → `/dashboard` (`app/page.tsx`)
- Health check API endpoint `GET /api/health` with Supabase connection test
- Full folder structure per TECH_SPEC.md (`app/(auth)`, `app/(app)`, `app/api`, `components/ui`, `components/modules`, `lib/supabase`, `lib/validations`, `lib/utils`, `lib/types`, `supabase/migrations`, `supabase/seed`)

### Verified
- `npm run build` passes — all 11 routes compile, 0 TypeScript errors
- Dev server runs — `/` returns 307 → `/dashboard`, `/dashboard` returns 200 with EQ design tokens rendered, `/api/health` returns `{"status":"ok","supabase":"connected (no tables yet)",...}` confirming Supabase credentials in `.env.local` work

### Decisions Made
- **Tailwind v4 used (deviation from prompt, within spec):** `create-next-app` installed Tailwind v4 (latest stable, per TECH_SPEC.md §Stack). V4 uses CSS-first config via `@theme` directive in `globals.css` — there is no `tailwind.config.ts` file. EQ tokens work identically (`bg-eq-sky`, `text-eq-ink`, etc.). Flag to Chat if v3 pinning is required.
- **Next.js 16 installed (not 14):** latest stable via `create-next-app@latest`. App Router behaviour unchanged from 14.
- Sidebar collapses to icon-only mode on toggle (per prompt).

### Blocked / Flagged for Chat
- **Not yet committed/pushed.** Step 14 (`git add . && git commit && git push origin main`) deferred to Royce to execute locally — Cowork does not push to production/remote without explicit per-session instruction per brief §8. Suggested commit message: `feat: scaffold Next.js project with EQ design system and Supabase connection`
- `SPRINT_1_COWORK_PROMPT.md` and `eq-solves-release-v1.5.zip` present in repo root — recommend `.gitignore`-ing or moving to a `docs/` folder before committing.

### Files Touched
- Created: `app/globals.css` (replaced), `app/layout.tsx` (replaced), `app/page.tsx` (replaced), `app/(app)/layout.tsx`, `app/(app)/{dashboard,sites,assets,maintenance,testing,reports,settings}/page.tsx`, `app/(auth)/login/page.tsx`, `app/api/health/route.ts`, `components/ui/{Button,Card,StatusBadge,FormInput,DataTable,Modal,SlidePanel,Sidebar,Breadcrumb}.tsx`, `lib/supabase/{client,server}.ts`, `lib/utils/cn.ts`, `lib/types/index.ts`, `CHANGELOG.md`
- Installed: `@supabase/supabase-js`, `@supabase/ssr`, `lucide-react`, `clsx`, `tailwind-merge`
