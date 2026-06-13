-- 0125_assets_canonical_id
--
-- Adds canonical_id and canonical_synced_at to the assets table so that
-- assets imported from sks-canonical (via pullFromCanonicalAction) can be
-- tracked without duplicating rows on subsequent imports.
--
-- canonical_id is the UUID assigned by the canonical store (sks-canonical
-- app_data.assets.id). After the first successful canonical pull, every
-- imported asset will have canonical_id set. Rows created directly in
-- EQ Service (not yet pushed to canonical) have canonical_id = NULL.
--
-- A UNIQUE constraint on (tenant_id, canonical_id) prevents accidental
-- duplicate imports when pullFromCanonicalAction runs more than once.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS canonical_id        uuid,
  ADD COLUMN IF NOT EXISTS canonical_synced_at timestamptz;

-- Per-tenant uniqueness: two assets in the same tenant cannot share a
-- canonical_id. Partial index so NULLs (Service-only rows) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS assets_tenant_canonical_id_key
  ON public.assets (tenant_id, canonical_id)
  WHERE canonical_id IS NOT NULL;

COMMENT ON COLUMN public.assets.canonical_id        IS 'UUID of the matching record in sks-canonical app_data.assets. NULL for Service-only assets not yet pushed.';
COMMENT ON COLUMN public.assets.canonical_synced_at IS 'Timestamp of the last successful canonical pull/push for this asset.';
