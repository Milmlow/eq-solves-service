-- ============================================================================
-- Migration: storage bucket for capture photos
-- ============================================================================

-- Create bucket (idempotent). Public reads, anon writes.
insert into storage.buckets (id, name, public)
values ('capture-photos', 'capture-photos', true)
on conflict (id) do nothing;

-- Anon can upload to their asset folder
drop policy if exists "capture_photos_anon_insert" on storage.objects;
create policy "capture_photos_anon_insert"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'capture-photos');

-- Anon can read (since bucket is public). Explicit policy for clarity.
drop policy if exists "capture_photos_anon_read" on storage.objects;
create policy "capture_photos_anon_read"
  on storage.objects for select
  to anon
  using (bucket_id = 'capture-photos');

-- Anon can delete their own uploads (needed for "remove photo" UX)
drop policy if exists "capture_photos_anon_delete" on storage.objects;
create policy "capture_photos_anon_delete"
  on storage.objects for delete
  to anon
  using (bucket_id = 'capture-photos');
