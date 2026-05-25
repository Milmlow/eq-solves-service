-- Migration 0108: Add freq_6yr to job_plan_items
--
-- Context: FREQUENCY_SUFFIX_MAP maps suffix '6' → '6yr' (6-year cycle).
-- freqColumn() already maps '6yr' → 'freq_6yr', but the column was missing
-- from the table. This aligns job_plan_items with 2yr / 3yr / 5yr / 8yr / 10yr.

ALTER TABLE public.job_plan_items
  ADD COLUMN IF NOT EXISTS freq_6yr boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.job_plan_items.freq_6yr IS
  'True when this item is required on a 6-year maintenance cycle.';
