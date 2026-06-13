-- 0128_lockdown_context_files
--
-- SECURITY FIX — information disclosure.
--
-- public.context_files holds internal development artefacts: session-handoff
-- notes, architecture decisions, and platform context (slug/filename/content,
-- ~141 rows as of 2026-06-13). Migration 00425 created a "Public read" policy:
--     CREATE POLICY "Public read" ON public.context_files
--       FOR SELECT TO anon USING (true);
-- The anon key ships in the client bundle, so this made every internal note
-- world-readable via the REST API (GET /rest/v1/context_files).
--
-- No application code reads this table (it is indexed by out-of-band tooling
-- only — verified: the sole references are generated types and migrations), so
-- removing public read breaks no app feature. After this migration the table
-- is service-role-only: RLS on, with just the existing "Service role write"
-- (FOR ALL TO service_role) policy. Any tooling that read context_files via
-- the anon key must switch to the service-role key.

DROP POLICY IF EXISTS "Public read" ON public.context_files;

-- "Service role write" (FOR ALL TO service_role USING (true)) remains and is
-- the only policy. service_role bypasses RLS regardless, so a true predicate
-- scoped to it is not a tenant-exposure — it is the intended write/read path
-- for the indexing tooling.
