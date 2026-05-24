-- Migration 0106: Field sync columns on sites.
--
-- EQ Field is the canonical owner of sites across the EQ suite. Service holds
-- a local mirror that is refreshed by the /admin/integrations "Sync from Field"
-- action. Two columns are added:
--
--   canonical_field_id  The Field-side UUID for this site. Set on first sync
--                       (matched by code if canonical_field_id is not yet set),
--                       then used as the stable lookup key on all future syncs.
--                       No FK — Field lives in a separate database.
--
--   field_synced_at     Timestamp of the last successful pull from Field. Used
--                       to show "last synced X ago" in the admin UI and to
--                       detect sites that have never been synced.
--
-- Both columns are nullable — existing sites are unaffected until the first sync
-- runs. The unique index on canonical_field_id prevents duplicate mirrors.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS canonical_field_id uuid        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS field_synced_at    timestamptz DEFAULT NULL;

-- Unique so the sync action's upsert-by-field-id never creates duplicates.
-- NULLS NOT DISTINCT is the default for unique indexes in Postgres 15+; explicit
-- NULL handling is fine here because unsynced sites all have NULL, which is
-- allowed to repeat under a unique index on a nullable column.
CREATE UNIQUE INDEX IF NOT EXISTS sites_canonical_field_id_idx
  ON public.sites (canonical_field_id)
  WHERE canonical_field_id IS NOT NULL;

COMMENT ON COLUMN public.sites.canonical_field_id IS
  'UUID of the corresponding site in EQ Field. Null until the first Field sync. '
  'Used as the stable match key on subsequent syncs.';

COMMENT ON COLUMN public.sites.field_synced_at IS
  'Timestamp of the last successful pull from the EQ Field API. '
  'Null for sites that have never been synced.';
