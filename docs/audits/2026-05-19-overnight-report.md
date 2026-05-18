# Overnight work — 2026-05-19

Royce authorised an overnight autonomous session covering four work items.
This doc tracks progress in real time and becomes the morning report.

## Scope (locked 2026-05-18 evening AEST)

1. **EQ Shell integration research** — read `C:\Projects\eq-shell` + design doc,
   produce proposal at `docs/audits/2026-05-19-eq-shell-integration.md`
   covering auth-contract fit, integration options, recommendation,
   file-by-file work estimate.
2. **Browser UX walkthrough** of creation flows on a local dev server —
   validate the [2026-05-18 audit](2026-05-18-creation-flows-ux.md) findings,
   capture screenshots / console / network, surface any new findings.
3. **Test scaffolding** for the friction paths uncovered by the audit —
   Playwright/Vitest skeletons in `tests/`, committed but not merged.
4. **CI cleanup** — fix the broken integration tests (`job_plans.site_id`
   seed issue) and triage `npm audit` (4 vulns on main: high `next` +
   `protobufjs`, moderate `postcss` + `@protobufjs/utf8`).

## Safety constraints in force

- **No merges.** Every PR opened tonight waits for Royce review in the
  morning.
- **No auth changes.** Anything touching `proxy.ts`, MFA, sign-in flow,
  or the EQ Shell auth contract is strictly research-only.
- **No deploys.** No `git push --force`, no Netlify env tweaks, no
  production-side actions.
- **No schema migrations.** Anything that would write to
  `supabase/migrations/` waits for daytime.
- **Posture: fix-anything-confident** — Royce's chosen aggression level
  for trivial / obvious fixes (typos, dead links, null checks). Subject
  to the four nons above.

## Progress log

| Time (UTC) | Item | Status | Output |
|---|---|---|---|
| 13:30 | Setup — new branch `overnight/2026-05-19`, progress doc created | done | this doc |
