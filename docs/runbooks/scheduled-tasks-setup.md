# Scheduled tasks — setup runbook

Two recurring routines were scoped on 2026-05-14 and approved:

1. **Supabase advisors daily scan** — catches new security / perf findings within 24h
2. **Weekly UX / data-integrity audit** — runs `docs/runbooks/weekly-audit.md`

This file holds the **exact prompts and cron expressions** to paste into `/schedule` in a normal interactive Claude Code session. Setup time: ~2 minutes total.

## Why this runbook exists

Three scheduler tools were tried in one session and all bounced:

| Tool | Why it failed |
|---|---|
| `/schedule` skill | claude.ai remote-auth offline |
| `mcp__scheduled-tasks__create_scheduled_task` | refuses to run in "unsupervised" mode — needs an interactive approval prompt |
| `CronCreate` (with `durable: true`) | runtime ignored the durable flag — created jobs were session-only and died when the conversation ended |

The first two are the real persistent-schedule paths. Either one works in a normal interactive Claude Code window where the approval modal is visible.

## Setup

In a normal Claude Code session at the EQ Solves Service repo root, run `/schedule` and paste each task below. Approve the modal when it appears.

### Task 1: Supabase advisors daily scan

- **Cron:** `13 7 * * *` (07:13 local time daily — off-peak minute to avoid the cron herd)
- **Cost:** ~$0.05 per run × ~30 runs/month = ~$1.50/month
- **Why daily:** new advisor findings should surface within 24h of a migration, not at audit time

**Prompt:**

```text
Run the daily Supabase advisor scan for the EQ Solves Service production project.

Project: urjhmkhbgaxrofurpbgc (EQ Solves Service prod database). Multi-tenant
maintenance management platform — RLS is load-bearing.

Steps

1. Load the Supabase MCP tool via ToolSearch if it isn't already in scope:
   select:mcp__6cc721e0-dd2d-40e4-a8a6-0aa3843e0ef8__get_advisors

2. Call it with project_id "urjhmkhbgaxrofurpbgc" and type "security".

3. Call it again with type "performance".

4. Output a concise markdown report:

   # Supabase Advisors — YYYY-MM-DD

   ## Security: N ERROR · N WARN · N INFO
   - {title}: {one-line description} → {remediation}
   (only list ERRORs always; list WARNs only if ≤ 5; skip INFO)

   ## Performance: N ERROR · N WARN · N INFO
   (same shape)

5. If both scans return zero ERROR and zero WARN, output a single line:
   "All clear — 0 ERROR, 0 WARN as of {date}".

Output budget: under 400 words. Be actionable, not exhaustive.

Why: Royce ships via Netlify auto-deploy and may not log into the Supabase
dashboard daily. New RLS gaps or missing indexes that appear after a migration
should surface fast, not at audit time.
```

### Task 2: Weekly UX / data-integrity audit

- **Cron:** `47 8 * * 1` (Monday 08:47 local time — early in the work week)
- **Cost:** ~$3-5 per run × 4 runs/month = ~$12-20/month
- **Why weekly:** the validated runbook produces ~10 findings per pass; weekly is the cadence at which signal stays sharp without becoming noise

**Prompt:**

```text
Run the weekly UX / data-integrity audit for EQ Solves Service.

The validated runbook lives at:
C:\Projects\eq-solves-service\docs\runbooks\weekly-audit.md

Steps

1. Read that runbook in full. It contains calibration context and the exact
   prompt to use.

2. From the runbook, locate the section that starts with "## The prompt" and
   ends at the next "##" heading. That's the audit prompt — copy it verbatim.

3. Spawn a general-purpose subagent with that prompt, working in
   C:\Projects\eq-solves-service\. The audit takes ~10 min and costs ~$3-5.

4. Present the subagent's report verbatim. Do NOT summarise or filter —
   Royce wants the raw findings to triage himself.

5. Append a "## Recommended triage" section with three lines:
   - Fix now: which 1-2 findings (if any) are small enough to land as a
     same-session PR
   - File as issues: which findings warrant GitHub issues with title prefix
     [audit-YYYY-MM-DD][HIGH|MED]
   - Discard: which findings look like false positives

6. Final line: "Audit complete · {N} HIGH · {N} MED · {N} LOW · {duration}".

If the runbook file is missing, output:
"Runbook file missing at expected path — task needs reconfiguration."

Why: UX / data-integrity bugs (silent action failures, stale client state,
missing error feedback) are the bugs static analysis misses but technicians
scream about. The runbook is validated; this just gates it to weekly so
signal doesn't decay.
```

## After setup

Once both tasks are scheduled:

- List active tasks: in `/schedule`, ask "list my scheduled tasks"
- Update a task's prompt: edit `C:\Users\EQ\.claude\scheduled-tasks\<taskId>\SKILL.md`
- Disable temporarily: in `/schedule`, ask "disable task <name>"
- Delete: in `/schedule`, ask "delete task <name>"

Add a `## History` table at the bottom of this file when you find the signal is genuinely useful (or kill the schedule if it isn't).

## History

| Date | What happened |
|---|---|
| 2026-05-14 | Scoped + approved both routines. All 3 schedule tools blocked the same evening — runbook captures the exact setup for a future interactive session. |
