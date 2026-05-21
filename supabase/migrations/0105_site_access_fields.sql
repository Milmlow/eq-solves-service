-- Migration 0105: site access fields — gate code, parking, after-hours,
-- safety notes on `sites`.
--
-- Background
-- ----------
-- The Site Context Card on /maintenance/[id] (PR #188) surfaces address +
-- primary contact so a tech opening a check on a phone sees "where do I
-- need to go" before the task list. The on-site reality is messier than
-- a postal address though: the tech also needs the gate / loading-dock
-- code, where to park, which after-hours number to call, and any site-
-- specific safety notes the customer requires (hi-vis, isolation
-- procedures, PPE).
--
-- Today those fields live in supervisors' phones and on tribal-knowledge
-- post-it notes at the SY3 office. The Jemena onboarding CLAUDE.md
-- explicitly flags 16 sites missing "site contact name / mobile / after-
-- hrs" — TO POPULATE on first visit. This migration gives the captured
-- data somewhere to land.
--
-- All four columns are nullable text. No defaults. No backfill — every
-- site starts with nothing and supervisors fill in as they go. The Site
-- Context Card renders nothing when the field is null, so the empty
-- state on existing data is identical to today's behaviour.
--
-- Idempotent via IF NOT EXISTS.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS gate_code text,
  ADD COLUMN IF NOT EXISTS parking_notes text,
  ADD COLUMN IF NOT EXISTS after_hours_phone text,
  ADD COLUMN IF NOT EXISTS safety_notes text;

COMMENT ON COLUMN public.sites.gate_code IS
  'Free-text gate / loading-dock / front-door access code or instruction. '
  'Visible to tenant members via the site_credentials RLS pattern is overkill '
  'for this — RLS on sites already tenant-scopes access. Field is optional.';

COMMENT ON COLUMN public.sites.parking_notes IS
  'Where to park, restrictions, after-hours options. Free text.';

COMMENT ON COLUMN public.sites.after_hours_phone IS
  'Phone number for out-of-hours access / emergency contact. Distinct from '
  'the primary_contact_id, which points at a daytime contact in site_contacts.';

COMMENT ON COLUMN public.sites.safety_notes IS
  'Site-specific safety requirements: PPE, isolation procedures, hot work '
  'rules, induction-required, etc. Free text — formalises tribal knowledge.';
