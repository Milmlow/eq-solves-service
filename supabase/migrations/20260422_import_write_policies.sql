-- ============================================================================
-- Migration: write policies for the Import flow (ImportPage.tsx)
--
-- Context
--   The init migration (20260417_init.sql) enabled RLS on jobs / assets /
--   classification_fields but only added SELECT policies for the anon role.
--   The office-facing Import flow runs in the browser as anon and needs to:
--     - upsert()  classification_fields   (INSERT + UPDATE)
--     - insert()  jobs
--     - insert()  assets
--   Without these policies every import fails with
--     "new row violates row-level security policy for table ..."
--
--   This migration follows the same "phase-1 permissive, tighten in phase-2"
--   philosophy the init migration explicitly documents on line 100. The URL
--   (and the optional job PIN) remain the access token model.
--
-- Also fixes
--   set_job_pin() is plain plpgsql, so calling it from anon tried to UPDATE
--   public.jobs and silently failed (the client only console.warns). Flip it
--   to SECURITY DEFINER so the RPC owns the write, matching verify_job_pin().
-- ============================================================================

-- Allow anon to upsert classification_fields (Import flow seeds these from
-- the parsed template). onConflict=(classification_code, spec_id) means the
-- upsert hits both INSERT and UPDATE policy paths, so we need both.
drop policy if exists "anon_insert_fields" on public.classification_fields;
create policy "anon_insert_fields"
  on public.classification_fields for insert
  with check (true);

drop policy if exists "anon_update_fields" on public.classification_fields;
create policy "anon_update_fields"
  on public.classification_fields for update
  using (true) with check (true);

-- Allow anon to insert jobs. No UPDATE policy — PIN updates go through
-- set_job_pin() (now SECURITY DEFINER, see below). If another UPDATE path
-- emerges, add a scoped policy then.
drop policy if exists "anon_insert_jobs" on public.jobs;
create policy "anon_insert_jobs"
  on public.jobs for insert
  with check (true);

-- Allow anon to insert assets. Rows are chunked 100-at-a-time from the
-- Import flow; the FK to jobs(id) still enforces a valid job_id.
drop policy if exists "anon_insert_assets" on public.assets;
create policy "anon_insert_assets"
  on public.assets for insert
  with check (true);

-- Make set_job_pin() a SECURITY DEFINER so the RPC can update pin_hash /
-- pin_salt without a broad UPDATE policy on public.jobs. Mirrors the
-- pattern already used for verify_job_pin() in migration 20260418.
create or replace function public.set_job_pin(job uuid, new_pin text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
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

grant execute on function public.set_job_pin(uuid, text) to anon;
