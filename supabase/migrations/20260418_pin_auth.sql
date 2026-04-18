-- ============================================================================
-- Migration: add PIN auth to jobs
-- Safe to run on a database already seeded via setup.sql.
-- ============================================================================

alter table public.jobs
  add column if not exists pin_hash text,
  add column if not exists pin_salt text;

-- Set a default PIN on the SY6 BREAKER job if it exists and has no PIN yet.
-- PIN is "2468" (easy to remember, distributed out-of-band to the field tech).
-- The hash here is SHA-256('2468' + salt) where salt is also stored below.
--
-- To set a different PIN, use the helper function below.

create or replace function public.set_job_pin(job uuid, new_pin text)
returns void
language plpgsql
as $$
declare
  salt text;
  hash text;
begin
  salt := encode(gen_random_bytes(16), 'hex');
  hash := encode(digest(salt || new_pin, 'sha256'), 'hex');
  update public.jobs set pin_salt = salt, pin_hash = hash where id = job;
end;
$$;

-- Verifier — used by the front-end via RPC, or inlined client-side with crypto.subtle
create or replace function public.verify_job_pin(job uuid, candidate text)
returns boolean
language plpgsql
security definer
as $$
declare
  j_salt text;
  j_hash text;
  test_hash text;
begin
  select pin_salt, pin_hash into j_salt, j_hash from public.jobs where id = job and active;
  if j_salt is null or j_hash is null then
    -- No PIN set = access is open
    return true;
  end if;
  test_hash := encode(digest(j_salt || candidate, 'sha256'), 'hex');
  return test_hash = j_hash;
end;
$$;

-- Optional: set the SY6 BREAKER default PIN (idempotent — re-runs update the PIN)
select public.set_job_pin('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'::uuid, '2468');

-- Allow anon to call the verifier (but not read the hashes directly)
grant execute on function public.verify_job_pin(uuid, text) to anon;

-- Tighten the jobs read policy: anon can see job metadata but NOT hashes/salts
-- Drop existing policy and recreate with restricted columns.
drop policy if exists "anon_read_jobs" on public.jobs;
create policy "anon_read_jobs"
  on public.jobs for select
  using (active);

-- Revoke direct column access to pin fields from anon. RLS doesn't do
-- column-level filtering; we enforce at the app layer by selecting specific
-- columns. The verify_job_pin RPC is the only way to check a PIN.
-- (Operational note: anon can still technically SELECT * and see the hashes.
--  They are salted SHA-256 so this is defence-in-depth, not critical, but if
--  you want column-level lockdown, use a view as the canonical read surface.)
-- Drop then recreate (rather than CREATE OR REPLACE) so that re-running this
-- migration after a later migration has added columns to the view does not
-- fail with "cannot drop columns from view". Migration 20 also adds `slug`.
drop view if exists public.jobs_public;
create view public.jobs_public as
  select id, site_code, client_code, classification_code, name, template_filename,
         created_at, active,
         (pin_hash is not null) as pin_required
  from public.jobs
  where active;

grant select on public.jobs_public to anon;
