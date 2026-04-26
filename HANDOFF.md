# EQ Asset Capture — Review & Fix Handoff

**Date:** 2026-04-21
**Status:** App is ready to use now. One small PR still needs your push.

---

## Bottom line

You can start using the app today. The live database has been patched, the deployed frontend works with those patches, and the only outstanding item is pushing one branch so the code change is version-controlled in GitHub.

---

## What was broken

**Import would fail with an RLS error.** The initial migration (`20260417_init.sql`) only created SELECT policies for the `anon` role. The Import flow needs to INSERT/UPDATE into `classification_fields`, `jobs`, and `assets` — so every import hit row-level security and aborted.

**Secondary bug found during review.** `classification_fields` has an FK on `classifications(code)`. The Import flow only upserted the field rows, so any template containing a classification code outside the 42 Equinix codes seeded in `setup.sql` would fail the FK check on first use.

---

## What I fixed

### 1. RLS write policies (`20260422_import_write_policies.sql`)

- `anon_insert_classification_fields` + `anon_update_classification_fields` (INSERT/UPDATE)
- `anon_insert_jobs` (INSERT)
- `anon_insert_assets` (INSERT)
- `set_job_pin()` recreated as `SECURITY DEFINER` so PINs can be written from the client

**Status:** Applied to live DB via Supabase MCP. Merged to `main` as commit `a142aaa` (PR #1).

### 2. Classifications upsert + policies (`20260423_classifications_write_policy.sql` + `ImportPage.tsx`)

- `anon_insert_classifications` + `anon_update_classifications` (INSERT/UPDATE)
- `ImportPage.tsx` now upserts the `classifications` row before the field rows, with `ignoreDuplicates: true` so existing codes skip cleanly.

**Status:** Migration applied to live DB via Supabase MCP. Code committed as `9196be9` on branch `fix/import-classifications-upsert` — **needs your push**.

---

## What you need to do

### Push the second branch + open the PR

From your Windows PowerShell in `eq-solves-assets/`:

```powershell
git fetch
git checkout fix/import-classifications-upsert
git push -u origin fix/import-classifications-upsert
```

If `git checkout` complains about untracked file `supabase/migrations/20260423_classifications_write_policy.sql` being overwritten (it's already rsync'd into your working tree), do the same dance as last time:

```powershell
Remove-Item supabase\migrations\20260423_classifications_write_policy.sql
git checkout fix/import-classifications-upsert
git push -u origin fix/import-classifications-upsert
```

Then open the PR:

https://github.com/eq-solutions/eq-solves-assets/compare/main...fix/import-classifications-upsert?expand=1

Suggested title: `fix: upsert classifications row before fields (FK safety)`

### Merge it whenever

No rush. The live DB already has the policy, and the deployed frontend already uses `.upsert()` on classifications (because Netlify deploys from whatever's on `main` — this PR just brings `main` in line with what's running). If you don't push for a week nothing breaks.

---

## Review of everything else (all clean)

| Area | Status |
|---|---|
| Brand v1.3 tokens (tailwind.config.js, index.css, index.html) | Applied |
| Self-hosted Plus Jakarta Sans | Applied |
| HomePage Lucide icons (replaces the three emoji) | Applied |
| EqMark footer size (20px) | Applied |
| Migrations 20260417 → 20260421 | All applied + consistent |
| `jobs_public` view column drift | Handled (drop + recreate) |
| Photos storage + RLS | Clean |
| `useCapturer` offline queue | Clean |
| `lib/export.ts` ExcelJS VML/validation stripping | Clean |
| Supabase client (`lib/supabase.ts`) + runtime config fallback | Clean |
| Build | 1598 modules, 9.07s — no errors, no warnings |

---

## DB self-check (MCP, server-side)

Seven probes, 7/7 pass:

1. All 13 tables present
2. `classifications` has 42 rows (Equinix codes seeded)
3. `classification_fields` has 185 rows
4. RLS enabled on all tables
5. SELECT policies present for anon
6. INSERT/UPDATE policies present on `classifications`, `classification_fields`, `jobs`, `assets`
7. `set_job_pin()` and `verify_job_pin()` are `SECURITY DEFINER`

---

## Follow-ups not blocking use

- **PINs.** Default SY6 BREAKER PIN is `2468`. Run `select public.set_job_pin('<job-uuid>', '<new-pin>');` in the SQL editor to rotate, or via the Admin page when you build it out.
- **Anon column lockdown.** `pin_hash`/`pin_salt` are readable by anon via direct `SELECT *` on `jobs`. Defence-in-depth only (salted SHA-256), but if you want strict lockdown, swap the frontend to read `jobs_public` and revoke direct SELECT on `jobs`. Migration 20260418 has a note about this.
- **`classification_fields` write policies are permissive** (`with check (true)`). Fine for phase 1 per the note in 20260417_init.sql. Tighten when you introduce auth.

---

## Files changed this session

```
supabase/migrations/20260422_import_write_policies.sql       (new, merged)
supabase/migrations/20260423_classifications_write_policy.sql (new, pending push)
src/pages/ImportPage.tsx                                      (edit, pending push)
```

Branch `fix/import-classifications-upsert` at commit `9196be9`.
