-- Migration 0124: Explicit service_role table grants
--
-- Supabase cloud projects have service_role granted ALL privileges on all
-- public-schema tables automatically via ALTER DEFAULT PRIVILEGES that the
-- platform sets up at project creation time. A fresh local Supabase instance
-- (supabase start / GitHub Actions CI) does not carry that same default
-- privilege context, so service_role INSERT on `tenants` raises
-- "permission denied for table tenants" even though BYPASSRLS is set.
--
-- RLS bypass (BYPASSRLS role attribute) and table-level GRANT are independent.
-- BYPASSRLS skips policy evaluation; it does NOT grant table privileges.
--
-- On remote (prod): GRANT is idempotent — re-granting an already-held
-- privilege is a silent no-op in PostgreSQL. Safe to apply.
-- On local / CI: adds the missing grants so integration tests can seed
-- and clean up tenants via the service_role key.
--
-- Note: ALTER DEFAULT PRIVILEGES FOR ROLE postgres is intentionally omitted.
-- That statement requires the caller to BE postgres or a superuser; migrations
-- run as supabase_admin (not postgres) in the local Docker stack, so it fails
-- with "permission denied to change default privileges". The explicit
-- GRANT ON ALL TABLES statements below are sufficient for all existing tables,
-- and new migrations that create tables in future can be GRANTed individually.

-- Schema USAGE
GRANT USAGE ON SCHEMA public   TO service_role;
GRANT USAGE ON SCHEMA app_data TO service_role;

-- Retroactive table grants (all tables that exist at migration time).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_data TO service_role;

-- Sequence grants (needed for nextval() on default-valued serial columns).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_data TO service_role;
