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

-- Schema USAGE
GRANT USAGE ON SCHEMA public   TO service_role;
GRANT USAGE ON SCHEMA app_data TO service_role;

-- Retroactive table grants (all tables that exist at migration time).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_data TO service_role;

-- Sequence grants (needed for nextval() on default-valued serial columns).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public   TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_data TO service_role;

-- Default privileges: future tables created by `postgres` automatically
-- inherit these grants so subsequent migrations don't need explicit GRANTs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_data
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_data
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- supabase_admin role exists on the cloud platform only — guard the
-- ALTER DEFAULT PRIVILEGES so the migration applies cleanly on local too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role';
  END IF;
END $$;
