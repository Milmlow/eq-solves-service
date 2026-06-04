# EQ Service — decision & cosmetic-sweep history

Dated PR-by-PR narrative lifted out of `CLAUDE.md` (2026-06-03) so the always-loaded
contract holds durable rules, not a changelog. Reference only. Authoritative history = git.
The durable UI rules (StatusBadge canonical, KindPill colours, sidebar grouping) live in
`CLAUDE.md`; current module behaviour lives in `docs/FEATURES.md`. This is the per-PR detail.

## UI cosmetic sweep (2026-04-28, PRs E–Q)

- **Maintenance check page (`/maintenance/[id]`)** — status-driven hairline accent at top (green=complete, red=overdue, amber=in_progress, gray=cancelled, sky=scheduled). Title `text-3xl text-eq-ink tracking-tight`. Section order: header → Linked Tests → Attachments → Asset table. Asset table has a free-text filter (name / Maximo ID / location) + sortable headers.
- **Customer Report (`/api/pm-asset-report`)** — cell padding vertical 90 / horizontal 140 dxa; per-asset info grid label cells mid-grey small caps (size 16) + bold value cells (size 18), no shaded label backgrounds.
- **Field Run-Sheet (PR #55)** — three formats (simple/standard/detailed) with the semantics now documented in FEATURES.md. Brand strip `adjustHex(primaryColour, -0.20)`.
- **Run-sheet subtle branding (PR L)** — asset card heading in tenant primary; brand-coloured rule between master register and detail cards (standard only); footer with company name + ABN + brand-coloured page numbers (run-sheet specific; other reports keep grey).
- **Customer Report deep detail (PRs O + Q)** — Test Records section adds: **RCD Circuit Timing — Per Board** (full per-circuit timing table per linked rcd_test: Section / Cct # / Trip mA / X1 No-Trip 0°/180° / X1 Trip 0°/180° / X5 Fast 0°/180° / Btn / Action; critical-load circuits amber; AS/NZS 3760 evidence) and **Breaker Test Detail** (per ACB/NSX: identification grid + readings table). Both gated on per-test `detail` payload presence — PPM-only reports unchanged.
- **TestDetailHeader (PR P)** — shared chrome (`components/ui/TestDetailHeader.tsx`) used by the acb/nsx/rcd detail page.tsx. Standardises breadcrumb + heading + subtitle + back-link. Workflow content untouched.
- **Cover redesign (PR #39)** — tenant logo only (customer logo dropped — duplicated the name in headline type), 56pt headline, italic subtitle removed.
- **Per-test-type Reports removed (PR #35)** — they produced a per-site whole-system PDF that didn't match how reports get generated. Reports now live on `/maintenance/[id]`.

## Schema transitions

- **`testing_checks` view dropped (PR M / migration 0086)** — the transition view from PR #28 removed. Every code path now reads `maintenance_checks` directly with `.in('kind', […])`.
- Migration 0080 collapsed the parallel `testing_checks` table into `maintenance_checks` (same UUIDs). Migration 0081 renamed `acb_tests.testing_check_id` / `nsx_tests.testing_check_id` → `check_id`.

## Build-failure lesson (2026-04-26)

Two prod build failures would have been caught by `npm run check` (`tsc --noEmit && next build`) — it catches Turbopack bundler rules (e.g. `react-dom/server` imports in app routes), not just type errors. Now a pre-push convention (in CLAUDE.md).
