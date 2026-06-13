-- 0130_instruments_canonical_id
--
-- Adds canonical_id + canonical_synced_at to instruments so canonical assets of
-- type 'plant_equipment' can be synced into the instruments register (SKS's own
-- test tools — Fluke/Megger/torque wrenches) without duplicating on re-pull.
--
-- pullCanonical routes asset_type='plant_equipment' canonical assets here
-- instead of public.assets (those are customer site assets). Verified: all
-- plant_equipment lives on the null-customer "SKS — Internal" site, never on a
-- customer site, so the routing never steals a customer's plant.

ALTER TABLE public.instruments
  ADD COLUMN IF NOT EXISTS canonical_id        uuid,
  ADD COLUMN IF NOT EXISTS canonical_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS instruments_tenant_canonical_id_key
  ON public.instruments (tenant_id, canonical_id)
  WHERE canonical_id IS NOT NULL;

COMMENT ON COLUMN public.instruments.canonical_id        IS 'UUID of the matching canonical app_data.assets row (asset_type=plant_equipment). NULL for instruments created directly in Service.';
COMMENT ON COLUMN public.instruments.canonical_synced_at IS 'Timestamp of the last canonical pull for this instrument.';
