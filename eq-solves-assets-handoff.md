# EQ Asset Capture — Handoff Brief

Snapshot: **2026-04-23**. Upload this + `eq-solves-assets-snapshot-2026-04-23.zip` into a fresh chat to continue work.

## What this is

Mobile-first web app for capturing data-centre commissioning asset data. Field techs walk a switchroom with a phone or laptop, enter nameplate values into a live form, and the office gets a synced, audit-trailed database instead of a 50-column XLSM that nobody can read on-site.

- **Who uses it:** Royce's field techs at SKS Technologies, doing breaker/ACB/panel data collection on Equinix and Schneider jobs.
- **Replaces:** Equinix's green-cell XLSM templates being filled in by hand and re-keyed in the office.
- **Output:** Equinix-format XLSM re-export with audit provenance columns, plus direct Supabase read.

## Live URL + repo

| Thing | Where |
|---|---|
| Production | https://eq-solves-assets.netlify.app |
| GitHub | https://github.com/eq-solutions/eq-solves-assets (private) |
| Supabase project | `hshvnjzczdytfiklhojz` |
| Hosting | Netlify (auto-deploys `main`) |
| Local mount | `C:\Projects\eq-solves-assets` (Windows) |

## Tech stack

Vite + React + TypeScript + Tailwind. Hash router. Supabase (PostgREST + anon RLS). ExcelJS for in-browser XLSM parsing. Offline-first capture queue in `localStorage` with a 30s background sync. No auth yet — PIN-gated via `pinGate` + `demo / demo1234` codes for now.

## What shipped today (2026-04-22 → -23)

Two PRs merged into main:

1. **PR #7 — `feat(capture): polish field-capture UX for on-site use`** (commit `f644b6e`)
   - `FieldEditor`: 900ms green-ring flash on every commit so the tech sees saves land.
   - `AssetList`: location dropdown + walking-order sort (location, then row_number). Hoisted the sort to `JobScreenPage` so Prev/Next follows the same order.
   - `AssetList`: per-asset sync status dot (grey = no captures, amber pulsing = queued, green = synced). Live via `subscribeQueue`.
   - `AssetList`: FilterChip tap targets bumped to 28px min-height.
   - `AssetCapture`: auto-focus first empty field on asset change.

2. **Fix on `feat/capture-ux-polish`** — `fix(import): Choose file button now opens the picker` (commit `e3e8295`).
   - Root cause: a real `<button>` nested inside a `<label>` swallows the click, so the label's default "activate the hidden `<input type=file>`" never fired.
   - Fix: replaced the label wrapper with `<div role="button">`, drive the picker imperatively via `inputRef.current.click()` on click / Enter / Space. Also reset `input.value` after selection so picking the same file twice still fires onChange.
   - **Status as of snapshot:** commit is on `feat/capture-ux-polish` branch. PR not yet opened / merged. Compare URL: https://github.com/eq-solutions/eq-solves-assets/compare/main...feat/capture-ux-polish

## Key files to know

| File | Purpose |
|---|---|
| `src/pages/ImportPage.tsx` | Upload Equinix XLSM → detect fields → create job. Where the Choose-file fix lives. |
| `src/pages/JobScreenPage.tsx` | Master-detail shell. Walking-order sort hoisted here. |
| `src/pages/jobscreen/AssetList.tsx` | 360px asset pane. Search, status chips, location filter, sync dot. |
| `src/pages/jobscreen/AssetCapture.tsx` | Right pane. Field grid, photos, prev/next nav, auto-focus. |
| `src/pages/jobscreen/FieldEditor.tsx` | Single-field control (LOV / NUM / DATE / FREETEXT) + flag + notes + commit flash. |
| `src/lib/queue.ts` | Offline-first capture queue. `enqueueCapture`, `syncPending`, `subscribeQueue`, `capturesForAsset`. |
| `src/lib/templateParser.ts` | ExcelJS parser for Equinix XLSM. HEADER_ROW=12, DATA_START_ROW=13, green fill `FF00FF00` = captureable. |
| `src/lib/reimport.ts` | Round-trip filled XLSM back to DB with audit provenance. |
| `src/lib/export.ts` | Export filled Equinix template + audit log. |
| `supabase/migrations/*.sql` | Schema: jobs, classifications, classification_fields, assets, captures. Anon RLS write policies live here. |

## Capture workflow design (so you don't re-litigate it)

- The XLSM is **input/output only** — the tech never edits it. They capture into the web app; the app exports the filled XLSM for Equinix handover.
- Offline-first is non-negotiable: data halls kill cell signal. Every capture lands in localStorage immediately; sync runs in the background when online.
- Writes are idempotent: `(asset_id, classification_field_id)` is the upsert key, so you can re-enter a value without duplicating.
- Walking order matters: the list sorts by location then row_number so the tech works down the switchroom in order without scrolling around.
- Flag + notes per field: cheaper than a "review later" queue, and gives the office a specific thing to resolve (e.g. "nameplate illegible — photo attached").

## Outstanding items

- **Open + merge the PR for the Import fix** (commit `e3e8295` on `feat/capture-ux-polish`). Until then the live `/#/import` Choose-file button is still broken — drag-and-drop works as a temporary workaround.
- Revoke the burned GitHub PAT from earlier this week (`github_pat_11CAY6CPQ0fuMZtn3Xdl0Q_...`). Still unrevoked.
- `HomePage` has emoji buttons that should become 16x16 Lucide SVGs per the brand brief (not urgent).
- Photo attachment flow exists (`PhotoPicker`) but hasn't been tested against Supabase Storage in production — worth a sanity check.

## Working in this repo

### Quick start from the zip

```bash
unzip eq-solves-assets-snapshot-2026-04-23.zip -d eq-solves-assets
cd eq-solves-assets
npm install
npm run dev
```

The zip does **not** include `.git` — clone fresh from GitHub if you need history or want to push. Supabase env: copy `.env.example` to `.env.local` and fill in the anon key.

### The NTFS ghost-lock quirk

Royce's repo is surfaced via virtiofs/9p from `C:\Projects\eq-solves-assets`. Git operations sometimes leave a 0-byte `.git/index.lock` or a zeroed `.git/index` that the Linux sandbox can't clear. Workflow:

1. rsync the repo to `/sessions/<sid>/work/eq-solves-assets/` (ext4, no lock issues).
2. Do all git work in the ext4 clone. Commits need inline identity: `git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "..."`.
3. rsync `.git/{objects,refs,logs}` back to the mount and copy the edited source files over.
4. Royce pushes from PowerShell: `Remove-Item .git\index.lock -Force; git push origin <branch>`. If the index is corrupt afterwards, `git reset --hard HEAD` cleans it up.

### Build check

```bash
npx tsc -b        # must exit 0
npx vite build    # should produce dist/ cleanly; chunk-size warning on exceljs.min is expected
```

## Who's who

- **Royce Milmlow** — Operations Manager at SKS Technologies (electrical contractor, data-centre projects). Owner of this repo.
- **Emma Curth** — Royce's partner, co-director on CDC Solutions + EQ Property Solutions. Not active on this repo but in the broader EQ Solutions orbit.
- **SKS clients driving the requirements:** Equinix Australia, Schneider.
- **EQ Solutions** — the umbrella Royce is building this under (not yet incorporated; pilot is the "Australian Housing Dividend"). `eq-solves-assets` is one of several apps under this banner.

## How Royce wants Claude to work

- Direct and concise; skip preamble.
- Ask clarifying questions only when genuinely needed.
- For documents and code: create the file first, explain after.
- If a task needs tooling (git, build), just do it — don't narrate the plan first.
- Australian FY (1 Jul – 30 Jun) if dates come up.
