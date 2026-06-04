# Customer config — Jemena NSW

Customer-specific reference (job plans, RCD workflow, site/asset data). Moved out of
`CLAUDE.md` (2026-06-03) — load on demand when working on Jemena. Onboarded April 2026
under the SKS tenant — first non-Equinix customer, first use of the customer-scoped job-plan tier.

- **Customer ID:** `556f999a-2023-50e3-ab07-a90056333cfe` · code `JEMENA-NSW`
- **16 sites** all in NSW with `JEM-XXX` codes (e.g. `JEM-NSY` North Sydney, `JEM-GRE` Greystanes). Full list: `supabase/seeds/jemena-onboarding.sql`.
- **47 assets** across 5 types: Distribution Board, Main Switchboard, UPS Distribution Board, ESS Distribution Board, Generator. Each board has `assets.jemena_asset_id` (JM######) where assigned, and `assets.expected_rcd_circuits` set (Phase 1 RCD import QC). Total expected circuits: 611.
- **Four customer-scoped job plans:**
  - `JEMENA-SWB-MAINT` (Switchboard PPM, `annual`) — 3 items: DB Maintenance, MSB Maintenance (N/A on sites without MSB), Thermographic FLIR. Default plan for the 45 DB/MSB assets.
  - `JEMENA-RCD-TEST` (RCD PPM, `biannual`) — RCD Time Test (annual, May only) + RCD Push Button Test (semi-annual, May + Nov). Per AS/NZS 3760. **Secondary overlay** — assets stay pinned to `JEMENA-SWB-MAINT` via `job_plan_id`; the RCD-overlay filter in `previewCheckAssetsAction` / `createCheckAction` swaps the join to `expected_rcd_circuits > 0` when an RCD plan is selected. Detected via `isRcdPlan()` (any `<TENANT>-RCD-TEST` plan works the same).
  - `JEMENA-GEN-RUN-START` (Generator PPM, `biannual`) — 8 items split semi_annual (minor) / annual (under-load run 15 min). The 2 FG Wilson generators (Greystanes + North Sydney) only.
  - `JEMENA-LIGHTING-AUDIT` (Lighting PPM, `quarterly`) — 5 items, Building walk-throughs. Old Guildford + Unanderra only. Quarterly assumed; confirm after first cycle.
- **6-monthly cycle** — May: full SWB-MAINT + RCD time-trip + push-button. November: RCD push-button only.
- **Calendar:** 16 entries in `pm_calendar` for May 1–15 2026, category `RCD testing`, with SKS Job Code in the description.
- **RCD workflow (delivered 2026-04-27, PRs #12–14, #18, #21–23):**
  - Schema: `rcd_tests` (header per board+visit, FK `check_id` → `maintenance_checks`) + `rcd_test_circuits` (per-circuit timing, `UNIQUE NULLS NOT DISTINCT (rcd_test_id, section_label, circuit_no)` so multi-section boards work).
  - Importer (`/testing/rcd/import`): parses Jemena's 2025 multi-tab xlsx, resolves sites/assets by name (strips "Jemena " prefix), finds-or-creates a `maintenance_check` for the (site, RCD plan, month) bucket, stamps `check_id` on each `rcd_tests`. **Structure-bootstrap tool, not a historical recorder** — values get overwritten onsite.
  - Onsite editor (`/testing/rcd/[id]`): `RcdTestEditor` view/edit toggle. **Critical-load circuits stay locked** behind a per-row "Override" toggle (guards UPS/ESS feeders). "Save & mark complete" propagates to the linked `maintenance_check`.
  - Year 2+ flow (no xlsx): New Check → site + Jemena RCD Testing → previews show `✨ N circuits will be pre-populated`. `createCheckAction`'s RCD-overlay block clones the latest `rcd_test`'s circuit structure into fresh draft `rcd_tests`, timing blank.
  - Validation: `lib/validations/rcd-test.ts`; cross-test ID injection blocked in `updateRcdCircuitsAction` (ownership check before mutation).
  - PDF regen via Gotenberg parked — the editor's complete state is the reportable artifact for now.
- **Sites missing data (per SOW):** site contact name/mobile/after-hrs null on all 16 (populate on first visit); some assets missing JM numbers.
- **Subcontractor exclusions:** UPS PPM owned by Vertiv, generator 6-monthly by Cummins (calendar-description note only — no scope flag on assets yet).
