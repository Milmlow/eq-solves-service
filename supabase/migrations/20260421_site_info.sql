-- ============================================================================
-- Migration: site info (drawings + contacts)
--   1. sites table keyed by site_code
--   2. site-drawings storage bucket (public PDFs)
--   3. Seed SY6 row
-- Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.sites (
  site_code    text primary key,                      -- 'SY6', 'SY3' etc.
  display_name text,                                  -- 'Equinix SY6' (optional, shown to tech)
  drawing_path text,                                  -- storage object path, e.g. 'SY6/layout.pdf'
  contacts     jsonb not null default '[]'::jsonb,    -- array of {role, name, phone, email}
  notes        text,
  updated_at   timestamptz not null default now()
);

-- Anon can read (no secrets here — phone numbers are work contacts)
alter table public.sites enable row level security;
drop policy if exists "anon_read_sites" on public.sites;
create policy "anon_read_sites"
  on public.sites for select using (true);

-- Seed SY6 with placeholders that the office can edit later.
-- Real contacts go in via Supabase Dashboard or a future office-side editor.
insert into public.sites (site_code, display_name, contacts, notes)
values (
  'SY6',
  'Equinix SY6',
  '[
    {"role": "Electrical supervisor", "name": "Simon Bramall", "phone": "+61 400 000 000", "email": "simon.bramall@skstech.com.au"},
    {"role": "Equinix DCOps", "name": "DCOps on-call", "phone": "+61 2 0000 0000", "email": "sy-dcops@equinix.com"}
  ]'::jsonb,
  'Update contacts via Supabase Dashboard → Tables → sites, or ask the office to edit.'
)
on conflict (site_code) do update
  set display_name = excluded.display_name,
      notes = excluded.notes,
      updated_at = now();

-- Storage bucket for site drawings (public read, like capture-photos)
insert into storage.buckets (id, name, public)
values ('site-drawings', 'site-drawings', true)
on conflict (id) do nothing;

-- Drop old policies if they exist (idempotent re-run)
drop policy if exists "anon_read_site_drawings" on storage.objects;
drop policy if exists "anon_upload_site_drawings" on storage.objects;

-- Public read, authenticated write (in practice the office uploads via dashboard)
create policy "anon_read_site_drawings"
  on storage.objects for select
  using (bucket_id = 'site-drawings');

create policy "anon_upload_site_drawings"
  on storage.objects for insert
  with check (bucket_id = 'site-drawings');
