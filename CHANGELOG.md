# CHANGELOG — EQ Solves Service

All notable changes to this project are logged here. Appended by Cowork at the end of every session.

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
