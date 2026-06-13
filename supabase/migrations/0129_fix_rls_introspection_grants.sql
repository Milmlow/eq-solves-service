-- 0129_fix_rls_introspection_grants
--
-- Migration 0126 created public.rls_introspection() and ran
-- `REVOKE ALL ... FROM public` to keep it off anon/authenticated. That was
-- insufficient on Supabase: the project's ALTER DEFAULT PRIVILEGES grant
-- EXECUTE on newly-created functions DIRECTLY to anon + authenticated (not via
-- the PUBLIC pseudo-role), so revoking from PUBLIC alone left those direct
-- grants intact. The security advisor flagged it as
-- anon_security_definer_function_executable — any anon caller could read the
-- full RLS policy structure via /rest/v1/rpc/rls_introspection.
--
-- Revoke explicitly from anon + authenticated so only service_role (server-side)
-- can call it. Verified on prod 2026-06-13: anon=false, authenticated=false,
-- service_role=true, and the advisor finding clears.

REVOKE ALL ON FUNCTION public.rls_introspection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_introspection() TO service_role;
