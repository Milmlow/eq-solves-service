-- Migration 0124: Explicit role table grants for CI / local dev
--
-- Supabase cloud projects set these grants up at project creation via ALTER
-- DEFAULT PRIVILEGES. A fresh local Supabase instance (supabase start in CI)
-- does not carry that context, causing two failure modes:
--
--   1. service_role INSERT on `tenants` raises "permission denied" even though
--      BYPASSRLS is set. BYPASSRLS skips RLS evaluation, NOT table-level GRANT.
--   2. authenticated DELETE on `maintenance_checks` raises "permission denied
--      for table tenant_members". The RLS USING clause queries tenant_members
--      directly, so authenticated needs SELECT on tenant_members.
--
-- Supabase cloud pattern (replicated here):
--   anon          → SELECT on all tables  (intake forms, public read)
--   authenticated → ALL on all tables     (RLS controls which rows)
--   service_role  → ALL on all tables     (BYPASSRLS + full admin access)
--
-- On remote (prod): GRANT is idempotent — re-granting an already-held
-- privilege is a silent no-op. Safe to apply.
--
-- 2026-06-13: the app_data grants that previously lived here were removed —
-- migration 0123 no longer moves site_credentials to app_data (it encrypts in
-- place in public), so app_data does not exist and granting on it would error.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO service_role;

GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
