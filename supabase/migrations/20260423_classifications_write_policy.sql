-- ============================================================================
-- Migration: allow anon to upsert classifications rows
--
-- Context
--   classification_fields has an FK on classifications(code). The Import flow
--   inserts field rows for the template's detected classifications. If a
--   classification is not already seeded (currently 42 Equinix codes), the FK
--   fails and the Import aborts. Fix: let the Import flow upsert the
--   classifications row first, so any template works.
--
--   Follows the phase-1 permissive stance documented in 20260417_init.sql.
-- ============================================================================

drop policy if exists "anon_insert_classifications" on public.classifications;
create policy "anon_insert_classifications"
  on public.classifications for insert
  with check (true);

drop policy if exists "anon_update_classifications" on public.classifications;
create policy "anon_update_classifications"
  on public.classifications for update
  using (true) with check (true);
