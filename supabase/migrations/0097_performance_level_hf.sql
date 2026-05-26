-- ============================================================================
-- 0097 — Add HF to performance_level allowed values
-- ============================================================================
-- Schneider MasterPact NW series uses H1, H2, H3, and HF performance classes.
-- HF = High Fault, 85 kA interrupting capacity (above H3).
-- The 0023 migration inline CHECK was never applied in production (column
-- already existed from 0022 with no constraint). This migration adds the
-- constraint fresh, including HF.
-- ============================================================================

ALTER TABLE acb_tests DROP CONSTRAINT IF EXISTS acb_tests_performance_level_check;

ALTER TABLE acb_tests
  ADD CONSTRAINT acb_tests_performance_level_check
  CHECK (
    performance_level IS NULL
    OR performance_level IN ('N1', 'H1', 'H2', 'H3', 'L1', 'HF')
  );
