# Capture-file-driven flow — design note

**For:** Royce, 2026-04-22
**Status:** Draft for approval

---

## The ask

> Import XLSM → identify green cells → create asset capture job →
> manufacture a HTML or Excel file to export with all breakers and
> required fields including dropdowns. Per-asset view may be slow;
> looking at ways to speed up.

## The insight

The **uploaded Equinix template is already the capture file you want**.
Green cells are empty, LOV dropdowns are live, asset rows pre-filled.
Techs fill it in Excel, we read it back.

No new file format to design, no dropdown logic to rebuild, no fidelity
loss. The file Equinix wants back at the end is the same file we ship
to techs at the start — round-trip.

## Proposed flow

```
┌──────────────────────┐
│ 1. Import XLSM       │ (today: parses + creates job)
│    Stash template in │ NEW: save to Supabase storage, keyed by job
│    storage           │
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│ 2. Download capture  │ NEW: echoes back the stashed template,
│    file              │      optionally pre-filled with any captures
│                      │      already written via the web UI
└──────────────────────┘
           │
           │  (offline — tech fills in Excel, dropdowns work natively)
           ▼
┌──────────────────────┐
│ 3. Re-import filled  │ NEW: parse filled file → match rows to assets
│    capture file      │      → write captures to DB
│                      │ Report: N written / M flagged / X unmatched
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│ 4. Export completed  │ (today: reads DB → writes values into template)
│    workbook          │ Same as today — final deliverable to Equinix.
└──────────────────────┘
```

Per-asset web UI stays as the secondary path — for photos and edge cases
where Excel is painful.

## What needs building

### DB
- **Storage bucket** `templates/` + RLS (anon read of its own job only)
- **Column** `jobs.template_path text` — where the original file lives
  in storage
- Migration: `20260422_templates_bucket.sql`

### Frontend
1. **ImportPage** — on successful import, upload the file to
   `templates/<job-id>/original.xlsm` and save the path on the job row
2. **JobPage / Admin** — new action "Download capture file" that:
   - Fetches `templates/<job-id>/original.xlsm`
   - Optionally overlays any DB captures into the green cells
   - Returns as download, **validations preserved** (do NOT run the
     `stripDanglingVmlContentType` — it would nuke dropdowns)
3. **New page** `/j/<slug>/re-import` — drop zone for filled capture
   file. Parses, matches, writes captures. Shows summary.

### Library
- `src/lib/captureFile.ts` — re-emits stored template with optional
  pre-fills. Most logic is already in `export.ts`; split out.
- `src/lib/captureFileParser.ts` — reads filled template, returns
  `Array<{ asset_id, spec_id, value }>`. Most logic is already in
  `templateParser.ts`; lift the green-cell extraction into a reusable
  function.

### Re-import matching rules
- Primary: match by **Asset ID** (col G)
- Fallback: match by **Asset Description** (col H) on the same
  classification
- Unmatched rows → flagged in a summary, not silently dropped
- Values only count as a capture if the cell is non-empty **and**
  different from the value already in the DB (avoids rewriting
  everything on every re-import)

## What about HTML?

Skip it. Excel is already on every laptop, the dropdowns are already
baked into the template, and techs are comfortable there. HTML adds
another surface with no benefit. If mobile data entry becomes a real
ask later, build a compact capture page then.

## Out of scope (for this pass)

- Photos in the capture file (stays web-only — Excel photo embedding
  is fiddly and large)
- Conflict resolution UI (who wins if web UI + capture file both touch
  the same cell). For MVP: **capture file wins on re-import, with an
  "undo re-import" button that restores from a pre-re-import snapshot**.
  Actually, simpler: capture file wins, no snapshot. Techs can re-edit
  on web after.
- Partial re-imports (uploading just rows you touched). Always
  re-imports the whole file; only non-empty cells write.

## Separately: Import diagnostics

Committed on branch `fix/import-diagnostics` (commit `9239ac9`). Adds
console.info/error at every stage of the import flow so when you next
try the SY7 file and it "doesn't work", devtools will show exactly
where it dies. Push and deploy whenever — no behaviour change, just
telemetry.

```
git fetch
git checkout fix/import-diagnostics
git push -u origin fix/import-diagnostics
```

PR: https://github.com/eq-solutions/eq-solves-assets/compare/main...fix/import-diagnostics?expand=1

---

## Decisions needed from you

1. **Storage path:** Supabase storage bucket vs a `bytea` column on
   `jobs`? (Recommend storage — easier to rotate, doesn't bloat
   Postgres. Bucket creation is one migration.)
2. **Capture file location in UI:** On JobPage as a button? Or its own
   `/j/<slug>/capture-file` page? (Recommend button in the existing
   Admin/Export area — one less route to design.)
3. **MVP scope — build all of (1/2/3) at once, or phase it?** You
   could ship just (1) + (3) immediately — upload-on-import and
   re-import — and re-download becomes "use the file you already have
   on your desk". That halves the work if you want it on-site fast.

I'll build whatever you greenlight. My instinct: **phase 1 =
re-import only**. You already have the file on your machine. You
don't need us to stash + serve it back. Just: drop a filled template
→ captures in DB. Ship in a day.
