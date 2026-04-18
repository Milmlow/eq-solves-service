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

Drag `dist/` to Netlify Drop (https://app.netlify.com/drop), or connect this repo to Netlify for auto-deploys from `main`.

### 4. Runtime config

Edit `/config.js` on the deployed site (Netlify → Deploys → latest → Edit). Set the real Supabase URL and anon key. Use `public/config.example.js` as a template.

This lets you rotate keys without rebuilding.

### 5. Verify

Visit `/#/debug` on the deployed site. All seven checks should pass.

---

## Routes

| Route | Purpose | Access |
|---|---|---|
| `/#/` | Home — live jobs list | public |
| `/#/debug` | Self-check diagnostic | public |
| `/#/import` | Upload a new template, create a job | office |
| `/#/j/:ref` | Asset list | PIN |
| `/#/j/:ref/a/:assetId` | Asset capture form | PIN + name |
| `/#/j/:ref/admin` | Desktop progress grid | PIN |
| `/#/j/:ref/export` | Generate completed workbook | PIN |

`:ref` accepts either a UUID or a short slug (e.g. `sy6-assets`). The router resolves either to the same job.

---

## Adding a new capture job

### Option A — UI

Visit `/#/import`, drop in the client's .xlsm template, fill in site code and (optionally) a 4-digit PIN, click Create.

### Option B — SQL (for scripting)

```
INSERT INTO jobs (site_code, client_code, classification_code, name, slug, active)
VALUES ('SY6', 'EQX', 'CRAC', 'SY6 CRAC — Asset Capture', 'sy6-crac', TRUE)
RETURNING id;
-- then insert assets for that job_id
SELECT set_job_pin('<job-uuid>'::uuid, '1234');  -- optional PIN
```

---

## Operational notes

**Export format.** Produces `.xlsx` (not `.xlsm`). ExcelJS doesn't preserve VBA macros reliably. If a client insists on macros, open the output in Excel and Save As .xlsm — content is preserved.

**Offline.** Writes land in localStorage immediately. A background worker drains to Supabase when online. The TopBar pill shows `SYNCED` / `N PENDING` / `N ERROR` / `OFFLINE`. Tap a red `ERROR` pill to see the last sync error. Nothing is lost if the device loses signal mid-capture.

**PIN rotation.** `SELECT set_job_pin('<job-uuid>'::uuid, '1234');` — takes effect on next PIN entry. Existing 12-hour passports remain valid until expiry.

**Photos.** Default bucket is public. Fine for internal use, not for client handover — flip to private and generate signed URLs before productising.

---

## Local development

```
npm install
npm run dev
```

Service worker registers even in dev. If caching misbehaves: DevTools → Application → Service Workers → Unregister.

### Code tour

```
src/
  App.tsx               Hash-based router
  pages/                HomePage, JobPage, AssetPage, AdminPage, ExportPage, ImportPage, DebugPage
  components/           EqMark, JobGuard, PinGate, TopBar, OverflowMenu, PhotoPicker, SiteInfoSheet, ShareDialog
  lib/
    queue.ts            Offline capture queue (source of truth)
    export.ts           ExcelJS writer + three-bug post-process repair
    templateParser.ts   .xlsm → schema inference
    router.ts           Hash parser + navigate()
    constants.ts        Capturer roster, sign-out helper
    supabase.ts         Client with runtime config fallback
    version.ts          APP_VERSION + BUILD_TIME for footer badge
  hooks/
    useJobData.ts       useJob, useAssets, useFields, useSite
supabase/
  migrations/           Chronological SQL migrations (run in order)
public/
  sw.js                 Service worker (version stamped at build)
  config.example.js     Template — copy to config.js with real values
  manifest.webmanifest  PWA manifest
```

---

## Design brief

UI adheres to EQ Design Brief v1.3 — Plus Jakarta Sans, Sky Blue (#3DA8D8) primary, Ice Blue (#EAF5FB) backgrounds, 8px grid, WCAG 2.1 AA contrast.

---

## Known limits

Mapped on the roadmap:

- **Single Supabase project** — no multi-tenancy. Fine for SKS as a single contractor. Would need RLS per contractor or project-per-tenant for externalisation.
- **Public photo bucket** — see Operational Notes.
- **No capture audit trail** — upserts overwrite silently.
- **No bulk-fill** — filling one field across 5 identical breakers at once is Phase 2.
- **No tests on the export pipeline** — three bugs have been patched. Vitest specs are the right call before onboarding a client other than Equinix.

---

## Licence

All rights reserved. © CDC Solutions Pty Ltd trading as EQ Solutions.

---

## Contact

Royce Milmlow — royce@eq.solutions
