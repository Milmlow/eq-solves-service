# Data Quality Checks — Catalog

Every invariant enforced by `audits/run.sql`, with the reason it exists. When a check fires, find it here first before debugging the data.

**Framework:** DAMA-DMBOK data quality dimensions (completeness, uniqueness, validity, consistency) plus Postgres/Supabase structural invariants.

**Levels:**
- `ERROR` — must be zero before a release. A release with any ERROR failure is blocked.
- `WARN` — allowed to be non-zero with a documented reason in `audits/baseline-*.md`.

To add a new check: add it to `run.sql`, document it here with the *why*, re-baseline.

---

## Completeness — required fields not null

Required for a row to be usable. A null in one of these fields means the record is broken and needs fixing before anything depends on it.

| Check | Level | Why |
|---|---|---|
| `completeness.assets.site_id` | ERROR | Every active asset must live on a site. Assets with null `site_id` are orphaned and don't appear in grouped views or site reports. |
| `completeness.assets.tenant_id` | ERROR | RLS depends on `tenant_id`. A null here is a security hole — the row becomes invisible to every tenant's policy. |
| `completeness.assets.job_plan_id` | WARN | Assets need a job plan to schedule maintenance against. Nulls are allowed temporarily during import/backfill but must be resolved before the asset is scheduled. Current known-null count is documented in the baseline. |
| `completeness.sites.customer_id` | ERROR | Every site belongs to a customer. A null here breaks customer reports and billing. |
| `completeness.sites.code` | ERROR | Code is the short identifier used everywhere in the UI (SY1, SYD11, STG). Nulls are never valid. |
| `completeness.sites.city` | ERROR | Required for reports, O&M manuals, dispatch. Forced by migration 0041. |
| `completeness.sites.postcode` | ERROR | Same as city — required for reports and dispatch. |
| `completeness.sites.state` | ERROR | Required for jurisdiction-aware reporting (standards and regulations differ across states). |
| `completeness.customers.name` | ERROR | Customer name is the primary display field across the app. Nulls and empty strings are both caught. |
| `completeness.defects.asset_id` | ERROR | A defect without an asset is not actionable. Hard requirement of the defects workflow. |
| `completeness.maintenance_checks.site_id` | ERROR | Maintenance checks are scheduled by site. A null here means the check has nowhere to run. |
| `completeness.pm_calendar.site_id` | ERROR | PM calendar entries drive scheduling. Nulls orphan the entry. |

---

## Uniqueness — no duplicates on natural keys

Duplicates corrupt counts, break imports, and confuse users who can't tell which record is "the real one".

| Check | Level | Why |
|---|---|---|
| `uniqueness.customers.tenant_name` | ERROR | Within a tenant, customer names must be unique (case-insensitive, whitespace-trimmed). Duplicates cause ambiguous customer dropdowns and double-counting in billing. Triggered the 2026-04-15 consolidation when `Equinix Australia` and `Equinix Australia Pty Ltd` coexisted. |
| `uniqueness.sites.tenant_code` | ERROR | Site codes like `SY1` must be unique within a tenant. Duplicates break the Sites page and asset imports. |
| `uniqueness.sites.tenant_name` | ERROR | Site names must be unique within a tenant for the same reason as codes. |
| `uniqueness.assets.site_serial` | WARN | Assets with the same serial number on the same site are almost always a data-entry mistake. WARN rather than ERROR because legitimate shared serials (multi-card units) do occur. |

---

## Validity — values inside the allowed domain

The database will accept any string in these fields — we enforce the shape at the audit layer until we can add CHECK constraints.

| Check | Level | Why |
|---|---|---|
| `validity.sites.postcode_format` | ERROR | Australian postcodes are exactly four digits. Catches typos, trailing spaces, and foreign-format imports. |
| `validity.sites.state_au` | ERROR | State must be one of `NSW, VIC, QLD, WA, SA, TAS, NT, ACT`. Catches full-name entries (`New South Wales`) and typos. |
| `validity.timestamps.assets` | ERROR | `updated_at < created_at` is physically impossible. A failure here points at a buggy trigger or a backdated import. |
| `validity.timestamps.sites` | ERROR | Same as assets. |
| `validity.timestamps.customers` | ERROR | Same as assets. |

---

## Consistency — cross-table agreement

The same fact can appear in multiple tables (e.g. an asset's site is stored on `assets.site_id` but also on `acb_tests.site_id` for query speed). When these disagree, one of them is wrong and a user somewhere is seeing stale data.

| Check | Level | Why |
|---|---|---|
| `consistency.assets.site_active` | ERROR | An active asset must be attached to an active site. The 2026-04-15 SY1/SY4 bug was exactly this — 488 assets orphaned on archived parent sites. |
| `consistency.sites.customer_active` | ERROR | An active site must belong to an active customer. Same class of bug as above. |
| `consistency.assets.site_tenant_match` | ERROR | `asset.tenant_id` must equal its site's `tenant_id`. A mismatch is an RLS hole — the asset could be visible to the wrong tenant. |
| `consistency.sites.customer_tenant_match` | ERROR | `site.tenant_id` must equal its customer's `tenant_id`. Same reason. |
| `consistency.acb_tests.site_matches_asset` | ERROR | `acb_tests.site_id` must match the current `assets.site_id`. When an asset moves between sites, all its test rows must follow. Catches migrations that forgot to update denormalised site columns. |
| `consistency.nsx_tests.site_matches_asset` | ERROR | Same as acb_tests. |
| `consistency.test_records.site_matches_asset` | ERROR | Same as acb_tests. |
| `consistency.defects.site_matches_asset` | ERROR | Same as acb_tests. |
| `consistency.acb_tests.tenant_matches_asset` | ERROR | Denormalised `tenant_id` on tests must match the asset's `tenant_id` — an RLS safety check. |

---

## Structural — Postgres / Supabase invariants

These are properties of the schema itself, not the data. A failure here means someone added a table without following the conventions in `AGENTS.md`.

| Check | Level | Why |
|---|---|---|
| `structural.rls_enabled` | ERROR | Every `public` table must have row-level security enabled. `AGENTS.md` mandates it. Catches new tables that shipped without RLS. |
| `structural.primary_key` | ERROR | Every `public` table must have a primary key. Required for Supabase realtime, for `onRowClick` navigation, and for safe deletes. |
| `structural.fk_covering_index` | WARN | Every foreign key should have a covering index. Migration 0042 fixed the whole schema once. WARN rather than ERROR because new FKs may be added in a migration that only adds the index in the *next* migration. If this fires, the next migration must include the covering index. |

---

## Not currently checked (known gaps)

Things we'd add if we had more time or the data to check against:

- **Accuracy** — reconciliation against an external source of truth (e.g. the Delta Elcom master file). Done manually on 2026-04-16; not automated because we only have one snapshot and the master file isn't a live feed.
- **Timeliness** — freshness thresholds on PM calendar / maintenance checks / test records. Needs Royce to define "stale" per table.
- **Supabase advisor findings** — currently run manually via `get_advisors`. Could be folded into `run.sql` via the advisor RPC, pending a cleaner API for it.
- **ACB/NSX field-level validity** — `performance_level in (N1,H1,H2,H3,L1)`, pole count reasonableness, IN rating ranges. Needs confirmation on which fields are required vs. optional.
- **Attachment orphans** — attachments pointing at deleted parent rows. Not yet a problem but will become one as the attachments table grows.
- **Audit log coverage** — every row mutation in the tables above should produce a matching `audit_logs` entry. Hard to check without sampling; deferred.

---

## How to run

```sql
-- Against any environment with psql or the Supabase SQL editor:
\i audits/run.sql
```

Or via the Supabase MCP:
```
execute_sql(project_id='urjhmkhbgaxrofurpbgc', query=<contents of audits/run.sql>)
```

Expected output: one row per check, failures first, ERRORs before WARNs. A clean run has zero ERROR failures. WARN failures must be accounted for in the current `audits/baseline-*.md`.
