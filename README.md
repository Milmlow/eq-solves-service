# EQ Asset Capture

Mobile-first asset data capture for Australian data centre commissioning. Turns Equinix-style IAM asset register spreadsheets into a field-friendly form, then exports a completed workbook for client handover.

Built by SKS Technologies for the Equinix SY6 breaker capture project. Designed to generalise to any .xlsm asset template — new job, no code change.

**Stack:** Vite + React + TypeScript + Tailwind · Supabase (Postgres, Storage, RPC) · Netlify · PWA with service worker

---

## Why this exists

Traditional field asset capture = a laptop on a pallet in the data hall, an .xlsm open in Excel, a tech reading breaker nameplates and typing them cell-by-cell. It's slow, error-prone, and the laptop dies halfway through SY6 Block 1.

This app replaces that with a phone. Tech scans a QR code from the office, walks to the breaker, taps dropdowns and fills fields, takes photos of the nameplate. Everything syncs live. Office watches progress remotely. End of the job, one click generates the completed workbook for Equinix.

---

## Core features

### Field capture
- Mobile-first form, tap-target dropdowns, 44px minimum touch targets
- Offline-first write queue (localStorage), auto-syncs on reconnect
- Inline photo capture (camera/gallery), thumbnails, lightbox, timestamps
- Flag-for-review toggle on any field with note prompt
- Copy-from-previous-asset shortcut — huge time saver on repetitive MSBs
- Name roster dropdown (site-specific) plus "Someone else" for sub-contractors
- Next/prev navigation, auto-save between taps

### Office tools
- Admin dashboard: live progress grid, KPIs, flagged items, per-capturer breakdown
- Template importer: drop an .xlsm, parse, create a job with short slug
- Export: upload original template, receive completed .xlsx
- QR share dialog: scan from a laptop to open on a phone
- Self-check diagnostic: seven automated checks validate the full stack
- Site info: per-site layout PDFs and contacts (tap-to-call, tap-to-email)

### Security + reliability
- PIN auth per job, SHA-256 hashed with salt, 12-hour device passport
- Rate-limited PIN attempts (10s / 30s / 2min progressive cooldown)
- Sign-out clears name and all PIN passes, fires event for mounted pages
- Service worker with version-stamped cache (auto-invalidates on deploy)
- Build timestamp visible in footer for bug-report traceability

### Export
- Three ExcelJS quirks auto-repaired in post-process (content-types, table attributes, data validations) so Excel opens the file without the "we found a problem" warning
- CSV fallback for office spot-checks before handover

---

## Deploy

### 1. Supabase project

Create a new Supabase project (or use an existing one). From the SQL editor, run each migration in `supabase/migrations/` in date order, or generate a consolidated `setup.sql` from them. The migrations install schema, RLS policies, default classifications and field definitions, PIN auth functions, and storage buckets. Idempotent — safe to re-run.

**Note:** `supabase/setup.sql` is git-ignored because it contains seeded client data. Keep it local.

### 2. Front-end build

```
cp .env.example .env.local
# edit .env.local — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run build
```

### 3. Deploy

This repo is connected to Netlify for auto-deploy on push to `main`. The build config lives in `netlify.toml` — publish dir `dist`, build command `npm run build`.

Production site: `https://eq-solves-assets.netlify.app`

Manual redeploy (from Netlify): Deploys → **Trigger deploy** → *Clear cache and deploy site*. Use "Clear cache" whenever env vars change — Vite bakes `import.meta.env.VITE_*` into the bundle at build time, so a cached build will ship the old values.

---

## Runtime configuration

The front-end resolves Supabase credentials with this precedence (see `src/lib/supabase.ts`):

1. `window.__EQ_CONFIG__` — populated by `/public/config.js`, fetched at page load. Edit post-deploy to rotate keys without rebuilding.
2. `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — baked in at build time from Netlify env vars (or local `.env.local` for `npm run dev`).

The committed `public/config.js` ships empty (`window.__EQ_CONFIG__ = {}`) so step 2 is the default path. The runtime override exists for key rotation in a pinch.

**Production Supabase project**

| Field | Value |
|-------|-------|
| Project name | `eq-asset-capture` |
| Project ref | `hshvnjzczdytfiklhojz` |
| Region | `ap-southeast-2` (Sydney) |
| URL | `https://hshvnjzczdytfiklhojz.supabase.co` |
| Anon key | See Supabase dashboard → Project settings → API, or Netlify env var `VITE_SUPABASE_ANON_KEY` |

**Netlify env vars required for production**

| Key | Notes |
|-----|-------|
| `VITE_SUPABASE_URL` | Full URL above |
| `VITE_SUPABASE_ANON_KEY` | Legacy JWT anon key (safe to expose — RLS enforces access) |

Set in Netlify → Site configuration → Environment variables, then trigger a *Clear cache and deploy*.

---

## Self-check diagnostic

The Self-check page at `/#/debug` runs seven automated checks in order. Any fail short-circuits subsequent checks (they stay in "Running" forever — that's why a config fail leaves the other six stuck).

| # | Check | What it validates | If it fails |
|---|-------|-------------------|-------------|
| 1 | Runtime config loaded | `window.__EQ_CONFIG__` or `VITE_*` env vars resolve to non-placeholder values | Set Netlify env vars and redeploy with cache cleared. See Runtime configuration above. |
| 2 | Supabase reachable | `HEAD /rest/v1/classifications` returns 2xx | Check Supabase project is `ACTIVE_HEALTHY`, key is valid, CORS allows the Netlify origin |
| 3 | Schema deployed | `classifications` table exists and returns rows | Run migrations in `supabase/migrations/` via Supabase SQL editor |
| 4 | Fields seeded | `classification_fields` row count > 0 | Same — migration `20260417_init.sql` seeds defaults |
| 5 | SY6 BREAKER job exists | Stable UUID `aaaa…eeee` resolves in `jobs` | Run `supabase/setup.sql` (git-ignored, kept local) |
| 6 | SY6 assets loaded | 101 rows in `assets` for that job | Same — `setup.sql` inserts the SY6 asset register |
| 7 | Captures writable | Probe insert + delete on `captures` round-trips | RLS policy on `captures` rejecting the anon role — check policies in migration `20260417_init.sql` |

Re-run any time from the Re-run button, or by navigating back to the page.

---

## Pre-site checklist

Before handing a phone to a tech on a job site, run through this on the device:

- [ ] Self-check `/#/debug` — all 7 green
- [ ] Open target job, enter PIN, load at least one asset form
- [ ] Capture one field offline (enable flight mode → edit → disable flight mode → watch Pending sync drain to 0)
- [ ] Take one photo — confirms storage bucket + RLS write
- [ ] Run Export once from `/j/<slug>/export` — confirms the workbook round-trips cleanly
- [ ] Confirm site info page loads any attached PDFs

---

## Local development

```bash
cp .env.example .env.local    # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                    # http://localhost:5173
```

`npm run build` produces `dist/`. `npm run preview` serves the built output locally to sanity-check production behaviour before pushing.

The service worker is disabled in dev — cache-invalidation only matters for deployed builds.
