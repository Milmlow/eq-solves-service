-- ============================================================
-- Migration 0094: Backfill new ACB/NSX columns from legacy
-- ============================================================
--
-- PURPOSE
-- -------
-- The acb_tests and nsx_tests tables carry two parallel column sets for
-- breaker identification because the 3-step canonical workflow and the
-- legacy bulk-edit form wrote to different columns:
--
--   Legacy  : cb_make,  cb_model,      cb_rating,  trip_unit
--   New     : brand,    breaker_type,  current_in, trip_unit_model
--
-- (cb_serial and cb_poles are shared — both surfaces wrote to the same
-- column name, so they don't need backfill.)
--
-- Audit #101 (2026-05-13, severity HIGH) found that the customer report
-- only read the LEGACY columns, so breakers entered via the canonical
-- workflow rendered as "—" in the PDF. PR #111 added a `new ?? legacy`
-- fallback in the report builders as a stopgap; this migration is the
-- structural fix that follows.
--
-- This migration is ONE-WAY: copy LEGACY -> NEW only when the new column
-- is null. It never overwrites populated new values and never touches the
-- legacy columns. Re-running is a no-op (the WHERE clause guards against
-- repeat writes).
--
-- ROLLBACK STRATEGY
-- -----------------
-- The legacy columns are untouched. To roll back, revert the code changes
-- in the same PR — the original data is still in the legacy columns. A
-- subsequent migration (not this one) will drop the legacy columns once
-- Royce has verified backfill quality against real customer data.
-- ============================================================

-- acb_tests backfill -----------------------------------------------------

UPDATE public.acb_tests
   SET brand = cb_make
 WHERE brand IS NULL
   AND cb_make IS NOT NULL;

UPDATE public.acb_tests
   SET breaker_type = cb_model
 WHERE breaker_type IS NULL
   AND cb_model IS NOT NULL;

UPDATE public.acb_tests
   SET current_in = cb_rating
 WHERE current_in IS NULL
   AND cb_rating IS NOT NULL;

UPDATE public.acb_tests
   SET trip_unit_model = trip_unit
 WHERE trip_unit_model IS NULL
   AND trip_unit IS NOT NULL;

-- nsx_tests backfill -----------------------------------------------------

UPDATE public.nsx_tests
   SET brand = cb_make
 WHERE brand IS NULL
   AND cb_make IS NOT NULL;

UPDATE public.nsx_tests
   SET breaker_type = cb_model
 WHERE breaker_type IS NULL
   AND cb_model IS NOT NULL;

UPDATE public.nsx_tests
   SET current_in = cb_rating
 WHERE current_in IS NULL
   AND cb_rating IS NOT NULL;

UPDATE public.nsx_tests
   SET trip_unit_model = trip_unit
 WHERE trip_unit_model IS NULL
   AND trip_unit IS NOT NULL;
