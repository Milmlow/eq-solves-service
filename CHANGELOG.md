# CHANGELOG — EQ Solves Service

All notable changes to this project are logged here. Appended by Cowork at the end of every session.

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
