-- ============================================================
-- Migration 0111: Supabase advisor security hardening (2026-05-31)
--
-- Clears the WARN-level findings from the database linter that are
-- genuine and safe to action. Three classes of fix:
--
--   1. function_search_path_mutable — pin search_path on 4 functions
--      that were missed when the rest of the schema was hardened.
--
--   2. anon_security_definer_function_executable (lint 0028) — revoke
--      EXECUTE from anon on every SECURITY DEFINER function. anon is
--      only ever used by the public intake forms (briefs / estimates /
--      estimate_events), whose policies are WITH CHECK (true) and call
--      none of these helpers, so anon never needs any of them.
--
--   3. authenticated_security_definer_function_executable (lint 0029) —
--      revoke EXECUTE from authenticated ONLY on functions that are
--      triggers or cron-only (never reachable via PostgREST /rpc).
--
-- Deliberately NOT touched (documented elsewhere):
--   * The RLS helpers (get_user_role, get_user_tenant_ids, is_admin,
--     is_super_admin, is_tenant_admin) keep authenticated EXECUTE — they
--     run inside RLS policies as the signed-in user; revoking would break
--     tenant isolation. The 0029 finding on these is accepted noise, same
--     as get_portal_* in migrations 0090/0091.
--   * The 4 "RLS policy always true" findings (anon intake inserts +
--     service-role notification insert) are explicit, allowed exceptions
--     per AGENTS.md security invariants. Left as-is by design.
--
-- NB: applied to the live project via the Supabase MCP on 2026-05-31; this
-- file is the repo record. Numbered 0111 (origin/main already carries a
-- 0110_performance_level_hf.sql from a parallel line of work).
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on the 4 flagged functions
--    (matches the house style: SET search_path = public, pg_temp)
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.fn_severity_from_reading_label(text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.set_context_files_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_customer_period_summary(uuid, uuid, timestamptz, timestamptz)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_dashboard_counts(uuid, uuid)
  SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions — never called via RPC. Revoke from all client roles.
--    The triggers still fire (they run as the table owner, independent of
--    these client-role EXECUTE grants).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_acb_reading_to_defect()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_nsx_reading_to_defect()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_test_record_reading_to_defect() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_check_item_to_defect()          FROM PUBLIC, anon, authenticated;

-- handle_new_user() is the auth.users signup trigger. The trigger keeps
-- firing on signup; this only removes the ability to call it via /rpc.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Maintenance / cron-only functions — service_role only. No client role
--    should reach these via /rpc.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.purge_expired_archives() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()        FROM PUBLIC, anon, authenticated;

-- list_active_supervisors() is invoked only by the dispatch-notifications
-- cron route, which uses the service-role client (granted in 0057).
REVOKE EXECUTE ON FUNCTION public.list_active_supervisors() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Functions legitimately called by signed-in users via /rpc — revoke
--    anon, keep authenticated. (search_path already pinned above for the
--    two summary/count helpers.)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_customer_period_summary(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_customer_period_summary(uuid, uuid, timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_dashboard_counts(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dashboard_counts(uuid, uuid) TO authenticated;

-- pm_calendar_for_supervisor is used by the supervisor-digest path. Keep
-- authenticated EXECUTE (harmless if only the cron calls it), drop anon.
REVOKE EXECUTE ON FUNCTION public.pm_calendar_for_supervisor(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pm_calendar_for_supervisor(uuid, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS helper functions — drop anon, KEEP authenticated.
--    These are evaluated inside RLS policies as the signed-in user, so
--    authenticated EXECUTE is load-bearing. anon never evaluates them
--    (anon only touches the WITH CHECK (true) intake tables).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_role(uuid)      TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_tenant_ids()    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_tenant_ids()    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin()               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin()               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_super_admin()         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_super_admin()         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(uuid)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_tenant_admin(uuid)    TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. logos bucket — drop the broad SELECT policy (lint 0025).
--    `logos` is a public bucket (public = true), so object reads happen via
--    getPublicUrl()/the public CDN and do NOT consult this RLS policy. The
--    only thing logos_select enabled was letting any client (incl. anon)
--    list every tenant's files. The app never calls .list()/.download()/
--    createSignedUrl() on this bucket — only .upload() (INSERT policy) and
--    .getPublicUrl() — so removing it changes no app behaviour.
--    INSERT/UPDATE/DELETE policies (authenticated-only) are left intact.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS logos_select ON storage.objects;
