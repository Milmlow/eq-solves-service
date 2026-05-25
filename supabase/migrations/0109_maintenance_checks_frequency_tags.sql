-- Migration 0109: Add frequency_tags to maintenance_checks
--
-- Context: Delta WO imports now create one check per site, merging groups
-- that span multiple job-plan frequencies. Since `frequency` is NULL on
-- these checks, frequency_tags carries the individual cycle strings so the
-- UI can render colour-coded pills (A, 2, S, etc.) instead of "—".
--
-- Populated by commitDeltaImportAction at import time. Null on all
-- standard (single-frequency) checks — they use the existing `frequency`
-- column as before.

ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS frequency_tags text[] DEFAULT NULL;

COMMENT ON COLUMN public.maintenance_checks.frequency_tags IS
  'Array of frequency values (e.g. [''annual'', ''2yr'', ''semi_annual'']) for
   multi-frequency import checks where frequency is NULL. Null on all
   standard single-frequency checks.';
