-- ============================================================
-- Migration 0121: pre_visit_brief_sent_at — cron dedup gate
--
-- Phase 2 of the pre-visit tech brief (docs/runbooks/pre-visit-tech-brief-spec.md).
-- The day-before cron sends a brief for each scheduled check exactly once.
-- This nullable timestamp records when a brief was last sent for a check;
-- the cron only sends where it IS NULL. Both the manual "Send brief" action
-- and the cron stamp it on a successful send. A >1hr reschedule resets it to
-- NULL (server action) so the cron re-fires for the new time.
--
-- Additive + nullable: zero-risk, no backfill needed.
-- ============================================================

ALTER TABLE public.maintenance_checks
  ADD COLUMN IF NOT EXISTS pre_visit_brief_sent_at timestamptz NULL;

COMMENT ON COLUMN public.maintenance_checks.pre_visit_brief_sent_at IS
  'When the pre-visit tech brief was last sent for this check. NULL = not yet sent (cron will send). Reset to NULL on a >1hr reschedule so the cron re-fires.';
