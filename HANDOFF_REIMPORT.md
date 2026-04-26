# Handoff — re-import + audit provenance

**Branch:** `feat/reimport-and-audit`
**Commit:** `c1c5909` (on top of `9239ac9` — the diagnostics branch)
**Build:** `npx tsc -b` clean · `npx vite build` clean (9.85s, no errors)

## What landed

### New page — Load capture (`/j/:jobRef/reimport`)
Drop a filled Equinix template, preview what will be written, then upsert in one shot.

- **Parse in-browser first.** Nothing hits Supabase until you click Write.
- **Preview shows:** rows matched / total in sheet, green columns mapped to fields, unmatched refs, unmapped columns.
- **Write** upserts all detected captures in 500-row chunks with `source='file_reimport'` and `source_file='<original filename>'`. Existing values for the same (asset, field) are overwritten.
- **Why this page:** at 120+ switchboards, the per-asset form is slow. Filling the Equinix template offline and re-importing is faster, and the signed workbook becomes a tangible audit artefact.

### Audit trail on captures table
Migration `supabase/migrations/20260424_capture_audit_columns.sql` (already applied to the live DB):

```sql
alter table public.captures
  add column source text not null default 'web',
  add column source_file text;

alter table public.captures
  add constraint captures_source_check check (source in ('web', 'file_reimport'));
```

Every capture now answers *where did this come from?* — web form or named workbook.

### Audit log CSV in Export
The Export page's CSV output is now titled "Audit log (CSV)" and carries two new columns — **Source** and **Source File** — alongside the existing Captured By / Captured At / Flagged / Notes. Any customer reviewing the handover can trace any value back to who, when, from which workbook.

## Files touched

```
src/App.tsx                                    modified  (route + nav wiring)
src/components/shell/Sidebar.tsx               modified  ("Load capture" item, FileUp icon)
src/lib/router.ts                              modified  (reimport route)
src/lib/export.ts                              modified  (Source/Source File in CSV)
src/pages/ExportPage.tsx                       modified  (select source columns, rename toggle)
src/types/db.ts                                modified  (CaptureSource type, Capture fields)
src/lib/reimport.ts                            NEW       (pure parser — no Supabase)
src/pages/ReimportPage.tsx                     NEW       (UI)
supabase/migrations/20260424_capture_audit_columns.sql   NEW
```

## To push (from Windows PowerShell)

```powershell
cd C:\Projects\eq-solves-assets

# Clear any NTFS ghost locks (harmless if none exist)
Remove-Item .git\index.lock -Force -ErrorAction SilentlyContinue
Remove-Item .git\index.stash.*.lock -Force -ErrorAction SilentlyContinue

# The feature branch is already committed locally — just need to check it out + push
git checkout feat/reimport-and-audit
git push -u origin feat/reimport-and-audit
```

If `git checkout` complains about local changes that would be overwritten, they're the in-session file copies I made — safe to discard:

```powershell
git checkout --force feat/reimport-and-audit
git push -u origin feat/reimport-and-audit
```

## To open the PR

Go to:
https://github.com/eq-solutions/eq-solves-assets/compare/main...feat/reimport-and-audit

Suggested title: **feat: re-import filled template + audit provenance on captures**

Body: paste the commit message — it's already structured for a PR description.

## Stacking note

This branch sits on top of `fix/import-diagnostics` (PR #5). If #5 merges first, this rebases onto main cleanly. If #5 is closed in favour of the actual fix, let me know and I can rebase this off main.
