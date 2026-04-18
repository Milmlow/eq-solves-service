-- ============================================================================
-- Migration: fixes & enhancements (round 2)
--   1. Slug column on jobs (short URLs)
--   2. Missing SELECT policy on capture_photos (photos weren't loading in UI)
--   3. BREAKER MOUNT: "DRAWOUT" → "WITHDRAWABLE"
--   4. TRIP MODEL: change from FREETEXT to LOV with Schneider MicroLogic list
-- Safe to run on an already-seeded database. Idempotent.
-- ============================================================================

-- 1. Slug column on jobs
alter table public.jobs add column if not exists slug text;
create unique index if not exists idx_jobs_slug on public.jobs(slug) where slug is not null;

-- Rebuild the jobs_public view so it exposes the slug
drop view if exists public.jobs_public;
create view public.jobs_public as
  select id, slug, site_code, client_code, classification_code, name, template_filename,
         created_at, active,
         (pin_hash is not null) as pin_required
  from public.jobs
  where active;
grant select on public.jobs_public to anon;

-- Backfill a slug for the SY6 BREAKER job
update public.jobs
  set slug = 'sy6-assets'
  where id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'::uuid
    and slug is null;

-- 2. Photos weren't appearing in the UI because anon couldn't SELECT the
--    capture_photos metadata rows (insert-only policy).
drop policy if exists "anon_read_photos" on public.capture_photos;
create policy "anon_read_photos"
  on public.capture_photos for select using (true);

drop policy if exists "anon_delete_photos" on public.capture_photos;
create policy "anon_delete_photos"
  on public.capture_photos for delete using (true);

-- 3. BREAKER MOUNT: rename DRAWOUT → WITHDRAWABLE
update public.classification_fields
  set options = array_replace(options, 'DRAWOUT', 'WITHDRAWABLE')
  where classification_code = 'BREAKER'
    and spec_id = 'BREAKER MOUNT';

-- 4. TRIP MODEL: upgrade from FREETEXT to LOV with Schneider MicroLogic list
--    (from MasterPact NT/NW catalog 0613CT0001)
update public.classification_fields
  set data_type = 'LOV',
      options = ARRAY[
        -- MicroLogic Basic Trip Units
        'MicroLogic 2.0 (LS0, IEC)',
        'MicroLogic 3.0 (LI, UL/ANSI)',
        'MicroLogic 5.0 (LSI)',
        -- MicroLogic A: with Ammeter
        'MicroLogic 2.0A (LS0, IEC)',
        'MicroLogic 3.0A (LI, UL/ANSI)',
        'MicroLogic 5.0A (LSI)',
        'MicroLogic 6.0A (LSIG)',
        -- MicroLogic P: with Power Metering
        'MicroLogic 5.0P (LSI)',
        'MicroLogic 6.0P (LSIG)',
        -- MicroLogic H: with Harmonic Metering
        'MicroLogic 5.0H (LSI)',
        'MicroLogic 6.0H (LSIG)',
        -- Escape hatch
        'Other (add note)'
      ]::text[]
  where classification_code = 'BREAKER'
    and spec_id = 'TRIP MODEL';
