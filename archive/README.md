# Archive

Point-in-time documents and historical work logs — kept for provenance but no
longer maintained. Moved here in the 2026-05-30 repo dead-weight sweep.

Living docs stay in the repo root (`README`, `CLAUDE`, `AGENTS`, `ARCHITECTURE`,
`LOCAL_DEV`, `CHANGELOG`). The live data-quality audit (`audits/run.sql` +
`audits/CHECKS.md`, wired into CI) stays under `audits/`.

## Contents

- `SPEC.md` — feature spec, frozen at Sprint 27 (09 Apr 2026). Current behaviour lives in `CLAUDE.md`.
- `ROADMAP.md` — sprint roadmap, frozen at Sprint 27. Migration source of truth is `supabase/migrations/`.
- `GO_LIVE_ROADMAP.html` — generated go-live snapshot (10 Apr 2026). Superseded by `docs/runbooks/onboarding-day.md`.
- `SECURITY_PUNCHLIST.html` — generated security checklist (11 Apr 2026). Superseded by `AGENTS.md` invariants + CI gates.
- `sessions/` — dated session work logs (Apr 2026).
- `audits/baseline-2026-04-16.md` — initial repo baseline snapshot.
- `audits/2026-04-18/` — point-in-time health / MFA-loop / tenant-assignment audit specs (all since shipped).
- `audits/2026-04-28-phase-2-merge/` — draft migration review; the merge shipped as migrations 0080/0081.
