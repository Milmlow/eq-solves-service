-- Add freq_6yr boolean column to job_plan_items.
--
-- The Delta WO frequency suffix '6' maps to 6-year (was incorrectly aliased
-- to semi_annual). This column brings job_plan_items in line with the full
-- FrequencyEnum used by the parser and the freqColumn() helper in actions.ts.

ALTER TABLE job_plan_items
  ADD COLUMN IF NOT EXISTS freq_6yr boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN job_plan_items.freq_6yr IS
  'True when this item is required on a 6-year maintenance cycle.';
