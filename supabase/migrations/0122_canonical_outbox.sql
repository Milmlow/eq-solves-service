-- 0099_canonical_outbox.sql
--
-- Transactional-outbox table for the canonical-api write path.
--
-- Why: EQ Service pushes customers/sites/assets/test-results/defects/events to
-- the canonical reference layer (sks-canonical) over HTTP via canonical-sync.ts.
-- That call was fire-and-forget: on any network / 5xx / non-JSON failure the
-- write was logged and SILENTLY DROPPED — no retry, no record. A canonical
-- outage therefore meant permanent drift between EQ Service and the reference
-- layer, undetectably (nothing reads canonical back to reconcile).
--
-- This table captures every sync whose inline attempt fails *transiently*
-- (network / 5xx / 429 / 408). A scheduled drainer
-- (/api/cron/canonical-outbox-drain) replays pending rows to canonical-api with
-- exponential backoff until delivered or exhausted. The hub upserts idempotently
-- on (tenant_id, external_id), so replaying a PUT is safe even if the original
-- inline attempt had actually landed.
--
-- Posture: RLS ON, zero policies => service-role only (the canonical baseline
-- posture used across this app). The app enqueues via the admin (service-role)
-- client and the drainer reads/writes via service role; no user touches it.

CREATE TABLE IF NOT EXISTS public.canonical_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- what to send
  method           text NOT NULL CHECK (method IN ('PUT', 'POST')),
  resource         text NOT NULL,           -- customers | sites | assets | asset_test_results | asset_defects | events
  external_id      text,                    -- PUT upsert key + write-back source (e.g. 'eq-service:12'); NULL for events
  event            text,                    -- POST event name (e.g. 'defect.created'); NULL for PUT
  body             jsonb NOT NULL,          -- exact JSON body to PUT/POST to canonical-api

  -- De-dupe: collapse repeated failed syncs of the same record into one pending
  -- row carrying the latest body. Entity PUTs use '<resource>:<external_id>';
  -- events use NULL (each event is distinct — Postgres UNIQUE permits many NULLs).
  dedupe_key       text UNIQUE,

  -- delivery state machine
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 10,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_status      integer,                 -- HTTP status of the last attempt
  last_error       text,
  canonical_id     text,                    -- canonical UUID returned on a successful PUT (audit)

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz
);

-- The drainer polls this: pending rows whose backoff has elapsed, oldest first.
CREATE INDEX IF NOT EXISTS idx_canonical_outbox_due
  ON public.canonical_outbox (next_attempt_at)
  WHERE status = 'pending';

-- Operational visibility (latest activity per state).
CREATE INDEX IF NOT EXISTS idx_canonical_outbox_status
  ON public.canonical_outbox (status, updated_at DESC);

ALTER TABLE public.canonical_outbox ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service-role only. Enqueue and drain both run with
-- the service-role key, which bypasses RLS. anon / authenticated get default-deny.
-- (Same posture as the canonical spine — RLS on + zero policies = locked.)

COMMENT ON TABLE public.canonical_outbox
  IS 'Durable outbox for canonical-api writes. Transient inline-sync failures land here; the canonical-outbox-drain cron replays them idempotently with backoff. RLS on + no policy = service-role only.';
COMMENT ON COLUMN public.canonical_outbox.dedupe_key
  IS 'Entity PUTs: "<resource>:<external_id>" (collapses repeated failed syncs to one pending row). Events: NULL (each distinct).';
COMMENT ON COLUMN public.canonical_outbox.status
  IS 'pending = awaiting delivery/retry; delivered = canonical-api accepted (2xx ok); dead = retries exhausted or permanent 4xx.';
