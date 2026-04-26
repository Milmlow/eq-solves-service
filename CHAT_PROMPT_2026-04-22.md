# Resume prompt — EQ Asset Capture — 2026-04-22

Paste everything below into a fresh Claude / Cowork chat tomorrow. It's self-contained so it works even on a different computer.

---

## Prompt to paste

I'm continuing work on **EQ Asset Capture** (`eq-solves-assets`). It's an internal web app I'm using for Equinix data centre commissioning — field techs import an Excel capture template for a job, capture asset data (with photos) against the template's classifications, then export a populated workbook. Vite + React + TypeScript + Tailwind front-end, Supabase back-end, Netlify deploy.

**My role:** Ops Manager at SKS Technologies. I own this app. I'm on Windows and push from PowerShell.

**Repo:** `eq-solutions/eq-solves-assets` (private). Default branch `main`.
**Supabase project:** `hshvnjzczdytfiklhojz` (ap-southeast-2, Supabase MCP connected).
**Live site:** Netlify (auto-deploys from `main`).

### State as of end of 2026-04-21

On `main` — last commit `bcd78a9` ("fix: upsert classifications row before fields"). Two fixes merged yesterday:

1. **PR #3** — Added `anon` INSERT/UPDATE RLS policies for `classification_fields`, `jobs`, `assets` so the Import flow actually works. Also made `set_job_pin()` SECURITY DEFINER. Migration `20260422_import_write_policies.sql`.
2. **PR #4** — Import now upserts the `classifications` row before its field rows (FK safety for any template with codes outside the 42 Equinix codes seeded in `setup.sql`). Migration `20260423_classifications_write_policy.sql`.

Both migrations already applied to the live DB. Frontend deployed. App is usable.

### What I might want to work on today

- Use the app end-to-end on a real Equinix template and see what breaks.
- Tighten the permissive `anon` write policies once I wire up proper auth.
- Lock down the `jobs.pin_hash` / `pin_salt` columns so anon can't `SELECT *` them directly (use `jobs_public` view as the canonical read surface).
- Replace the three emoji buttons on HomePage — done; now verify across browsers.
- PIN rotation UX in Admin.
- Address any issues I find during real use.

Ask me first what I want to focus on — don't assume.

### Working constraints (important)

- **Windows + NTFS mount quirk.** `.git/index.lock` ghosts sometimes appear. Workflow: you clone to ext4 sandbox (`/sessions/.../work/eq-solves-assets`), do the git work there, rsync objects + refs back to the NTFS mount. I push from Windows PowerShell. No `gh` CLI on my side — use web compare URL for PRs: `https://github.com/eq-solutions/eq-solves-assets/compare/main...<branch>?expand=1`
- **CRLF drift.** Assume files on the NTFS mount may have mixed line endings. Do the real work in the ext4 clone.
- **Brand v1.3 is already applied.** Tokens: Deep Blue `#2986B4`, border `#E5E7EB`, status `#16A34A` / `#D97706` / `#DC2626`, muted `#666666`, self-hosted Plus Jakarta Sans. Don't re-patch.
- **Tone:** direct, concise. Skip preamble. For documents, create the file first and explain briefly after.

### First thing to do

Read `HANDOFF.md` in the working folder for the detailed yesterday summary, then ask me what I want to tackle.

---

## Notes for me (not for the prompt)

- **Files:** `eq-solves-assets-2026-04-21.zip` in the workspace folder is a clean snapshot with `.git` included (no `node_modules`, no `dist`, no data zips). On the new machine: unzip → `npm install` → `npm run dev`. `.env` is NOT in the zip — copy `.env.example` and fill the Supabase URL + anon key (or drop the keys into `public/config.js` for runtime config).
- **Token:** the GitHub PAT I pasted yesterday was used to push + merge PR #4, then scrubbed from the sandbox. **Still need to revoke it** at https://github.com/settings/tokens and issue a fresh one if anything still points at it (Netlify env, local Windows credential manager, any GitHub Actions secrets).
- **`.env` / secrets** are gitignored — bring them over separately if needed, don't commit.
