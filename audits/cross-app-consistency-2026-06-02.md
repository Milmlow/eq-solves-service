# EQ suite — cross-app UI consistency survey

**Date:** 2026-06-02
**Auditor:** autonomous overnight session (Opus 4.8)
**Apps surveyed:** EQ Shell (`eq-shell`), EQ Field (`eq-solves-field`), EQ Service (`eq-solves-service`).
**Method:** read-only audit of each app against the canonical EQ design profile.
**Note on placement:** this is a cross-repo document — it lives here for review convenience but **belongs in `eq-context`** alongside the other consolidation docs (`design-system-consolidation-2026-05-31.md`). Relocate when convenient.

---

## TL;DR

The suite is **token-consistent at the foundation** and drifts only at the edges. All three apps agree on the brand palette and type. The recurring cross-app problems are exactly the four on the standing hit-list: **fonts loaded from the Google CDN instead of self-hosted, status colours hardcoded as Tailwind hexes instead of the canonical `--eq-success/warning/error` tokens, a couple of stray gradients, and vendored token copies that will drift.**

| App | Stack | Tokens | Components | Fonts | Status colours | Verdict |
|---|---|---|---|---|---|---|
| **Shell** | Vite + React, vanilla CSS | ✅ pinned `#v1.2.0` + regen script | ✅ uses `@eq-solutions/ui` (Button/Table/Skeleton/FormInput) | ⚠️ Google CDN | ❌ Tailwind hexes (`#22C55E/#F59E0B/#EF4444`) | Strong foundation, status + font drift |
| **Field** | Vanilla HTML/JS, no bundler | ⚠️ **vendored** frozen copy | n/a (can't — no React) | ⚠️ Google CDN | ⚠️ data-viz hexes (intentional) | Clean & well-scoped; vendor = latent drift |
| **Service** | Next.js + Tailwind 4 | ✅ pinned `#v1.2.0` | ✅ uses `@eq-solutions/ui` + local lib | ✅ **self-hosted** (`next/font`) | ✅ tokenized (fixed this sprint) | Best-in-class; the reference |

---

## The consistent wins (don't regress these)

- **One palette, exact match.** `--eq-sky #3DA8D8`, `--eq-deep #2986B4`, `--eq-ink #1A1A2E`, etc. resolve identically in all three apps. The JSON-source → multi-target token build is doing its job.
- **Multi-tenant scoping is correct.** Field keeps the SKS palette strictly behind `body.tenant-sks` (with `body:not(.tenant-sks)` remaps back to EQ); no SKS colour leaks into the EQ default scope. This is the pattern other apps should copy when they add tenants.
- **Icon systems are correctly *different* per app** — Service = Lucide, Field = unicode/emoji — and each is internally consistent. (One small exception in Shell, below.)

---

## Cross-app drift — ranked by leverage

### 1. Status colours: stop hardcoding Tailwind hexes — use the status tokens  *(highest leverage; affects Shell + Field)*
The tokens already exist: `--eq-success-text #15803D`, `--eq-warning-text #B45309`, `--eq-error-text #B91C1C` (+ `-bg` variants). Apps keep reaching for Tailwind's `#22C55E / #F59E0B / #EF4444 / #16A34A / #D97706 / #DC2626` instead.

- **Shell** — `App.css` activity/status dots use `#22C55E`, `#F59E0B`, `#EF4444` (`:1854`, `:2060–2062`, `:2115`, `:2133`). These silently redefine success/warning/error across the hub. **Swap to `var(--eq-success-text)` etc.**
- **Service** — was the same; **fixed this sprint** (RouteProgress + MonthGrid now tokenized). Use as the worked example.
- **Field** — uses `--green #16A34A`, `--amber #D97706`, `--red #DC2626` as data-viz colours. Lower priority (these are category/legend colours, applied to both tenants by design), but the offline banner (`base.css:225–226`) is a genuine status surface and should use `--eq-warning-bg/text`.

**Why it matters:** this is the single most common drift across the suite and the one most visible to users (every status dot, badge, and banner). A token sweep makes status colour identical everywhere and theme-able in one place.

### 2. Self-host the font — kill the Google CDN dependency  *(affects Shell + Field)*
- **Service** already self-hosts via `next/font/google` (build-time, no runtime CDN).
- **Shell** loads Plus Jakarta from `fonts.googleapis.com` (`index.html:9`).
- **Field** loads Plus Jakarta + DM Mono from Google Fonts (`index.html:45`).

**Fix once, centrally:** ship the WOFF2 files in `@eq-solutions/tokens` (the standing recommendation) and have each app `@font-face` from the package / a local copy. Removes a third-party runtime dependency and a privacy/latency footgun, and guarantees identical rendering. This is item (1) on the design-system hit-list and still open.

### 3. Vendored token copies will drift  *(Field)*
Field **vendors** a frozen `styles/tokens.css` (v1.1) rather than pinning the package (no bundler, so it can't `@import` from `node_modules` the way Shell/Service do). The copy is currently accurate, but it's a copy — it *will* fall behind v1.2.0 the moment canonical tokens move. Worse, Field's `base.css` defines fallback vars that have already drifted from canon:
- `--blue-lt #EFF4FF` vs canonical `--eq-ice #EAF5FB` (`base.css:20`)
- `--surface-2 #F8FAFC` vs `--eq-gray-50 #F6F3EE` (`base.css:37`)

**Fix:** add a tiny build/sync step (or Netlify build hook) that copies `tokens.css` from the pinned package on each deploy — the same pattern Shell uses (`scripts/build-public-tokens.mjs`). Re-point the drifted fallbacks at the tokens.

### 4. Small per-app cleanups
- **Shell** — skeleton loader uses a `linear-gradient` shimmer (`App.css:1176`); prefer `@eq-solutions/ui` `Skeleton` (solid pulse) for consistency with Service. IconRail active nav uses a hardcoded `#3DA8D8` left border (`IconRail.css:96`) — tokenize to `var(--eq-sky)`. TenantSwitcher uses unicode `▴/▾/→` glyphs (`TenantSwitcher.tsx`) while the rest of Shell is Lucide — swap to `ChevronUp/Down`, `ArrowRight` for icon-system consistency.
- **Field** — gate error text `#FCA5A5` (`base.css:909`) is an off-token salmon; lean it toward `--eq-error-text`. (Field's access-gate gradient is SKS palette and correctly tenant-scoped — not a violation.)
- **Service** — `hover:shadow-md` on static cards (`KanbanBoard.tsx:155`, `SiteGroupedView.tsx:579`); use border swap only. (See the Service-specific audit.)

---

## Component-layer reality

Tokens unify everything; **components can't** — a React lib (`@eq-solutions/ui`) serves Shell + Service but cannot serve Field (vanilla) or Quotes (Flask). So the achievable shape is **shared tokens everywhere + thin per-stack component layers**, which is what exists today. The lever for Shell/Service convergence remains *fattening `@eq-solutions/ui`* (Modal/FormInput/StatusBadge/Card/Toast/Tabs — promote Service's mature versions), per the existing consolidation ADR. Field stays token-aligned but component-independent by necessity, and that's fine.

---

## Suggested next actions (in leverage order)

1. **Status-token sweep in Shell** (`App.css` `#22C55E/#F59E0B/#EF4444` → `var(--eq-*-text)`). Half a day; high visual impact; mirrors the Service fix just landed.
2. **Self-host the font in `@eq-solutions/tokens`**, then re-point Shell + Field. One PR in the tokens repo + a one-line change per app.
3. **Field token-sync step** so the vendored copy can't drift; fix the two drifted fallback vars.
4. **Promote Service's components into `@eq-solutions/ui`** (Modal/StatusBadge/Card/Toast) to shrink the Shell/Service duplication surface.

None of this is large; it's the standing hit-list, now with file:line targets per app.
