-- Migration 0124: Explicit role table grants for CI / local dev
--
-- Supabase cloud projects set up these grants at project creation time via
-- ALTER DEFAULT PRIVILEGES. A fresh local Supabase instance (supabase start
-- in CI) does not carry that same context, causing two failure modes:
--
--   1. service_role INSERT on `tenants` raises "permission denied" even though
--      BYPASSRLS is set. BYPASSRLS skips RLS evaluation, NOT table-level GRANT.
--
--   2. authenticated DELETE on `maintenance_checks` raises "permission denied
--      for table tenant_members". The RLS USING clause directly queries
--      tenant_members (not via a SECURITY DEFINER wrapper), so authenticated
--      needs SELECT privilege on tenant_members to evaluate the policy.
--
-- Supabase cloud pattern (replicated here):
--   anon       → SELECT on all tables  (intake forms, public read)
--   authenticated → ALL on all tables  (RLS controls what rows they touch)
--   service_role  → ALL on all tables  (BYPASSRLS + full admin access)
--
-- On remote (prod): GRANT is idempotent — re-granting an already-held
-- privilege is a silent no-op in PostgreSQL. Safe to apply.
--
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres is intentionally omitted.
-- That statement requires the caller to BE postgres or a superuser; migrations
-- run as supabase_admin in the local Docker stack, so it fails with
-- "permission denied to change default privileges".

-- ----------------------------------------------------------------
-- Schema USAGE
-- ----------------------------------------------------------------
GRANT USAGE ON SCHEMA public   TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_data TO service_role;

-- ----------------------------------------------------------------
-- Table grants (all tables existing at this migration's apply time)
-- ----------------------------------------------------------------
GRANT SELECT                              ON ALL TABLES IN SCHEMA public   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE      ON ALL TABLES IN SCHEMA public   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE      ON ALL TABLES IN SCHEMA public   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE      ON ALL TABLES IN SCHEMA app_data TO service_role;

-- ----------------------------------------------------------------
-- Sequence grants
-- ----------------------------------------------------------------
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_data TO service_role;
