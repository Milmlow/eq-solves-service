-- migration: 0113_canonical_sync_columns
-- Add canonical sync tracking columns to customers and sites.
--
-- canonical_id        — UUID returned by the canonical API after a successful upsert.
--                       Null until the first successful push (or when the API key is
--                       not configured). Used for dedup on subsequent upserts.
-- canonical_synced_at — Timestamp of the last successful push to the canonical API.
--                       Can be used to build a "sync freshness" indicator in admin UI.
--
-- These columns are referenced in app/(app)/customers/actions.ts and
-- app/(app)/sites/actions.ts but were never backed by actual columns — the updates
-- used `as never` to bypass type checking and silently no-op'd. This migration
-- makes the storage real.
--
-- No RLS changes needed — both tables already have tenant-scoped policies and these
-- columns carry no tenant-boundary-relevant data.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS canonical_id         uuid,
  ADD COLUMN IF NOT EXISTS canonical_synced_at  timestamptz;

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS canonical_id         uuid,
  ADD COLUMN IF NOT EXISTS canonical_synced_at  timestamptz;

COMMENT ON COLUMN public.customers.canonical_id        IS 'UUID assigned by the canonical API (eq-canonical-internal). Null until first successful sync.';
COMMENT ON COLUMN public.customers.canonical_synced_at IS 'Timestamp of the last successful push to canonical.';
COMMENT ON COLUMN public.sites.canonical_id            IS 'UUID assigned by the canonical API (eq-canonical-internal). Null until first successful sync.';
COMMENT ON COLUMN public.sites.canonical_synced_at     IS 'Timestamp of the last successful push to canonical.';
