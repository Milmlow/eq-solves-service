-- Migration 0114: C6 — close the cross-tenant super_admin isolation hole.
--
-- BACKGROUND
-- `public.is_super_admin()` (migration 0002) checks whether the caller holds
-- role='super_admin' in ANY tenant, with no tenant argument. Several policies
-- then granted access via `OR public.is_super_admin()`, letting a super_admin
-- in tenant A read/manage OTHER tenants' rows (tenants, tenant_settings,
-- tenant_members, orphaned_user_assignments). Royce's directive: fully
-- isolated tenants — no cross-tenant access from any tenant-held role.
--
-- WHAT THIS DOES
--   * Rewrites every policy that used is_super_admin() so reach is tenant-
--     scoped. A tenant admin (super_admin/admin = canonical "manager") sees and
--     manages ONLY their own tenant.
--   * Tenant provisioning/teardown (tenants INSERT/DELETE) becomes a PLATFORM
--     operation: no authenticated policy at all. The service-role client
--     (createAdminClient, behind EQ_PLATFORM_ADMIN_KEY in /api/tenants*)
--     bypasses RLS for those out-of-band ops.
--   * Neutralises is_super_admin() itself: REVOKE EXECUTE from authenticated so
--     no tenant session can call the cross-tenant check. The function body is
--     LEFT IN PLACE (not dropped) so this migration is reversible; drop it in a
--     follow-up once a live pg_depend check confirms zero remaining references.
--
-- is_tenant_admin(p_tenant_id) and get_user_role(p_tenant_id) are already
-- tenant-scoped and already treat super_admin+admin as the tenant manager, so
-- they are unchanged and remain the correct authority for own-tenant actions.
--
-- ROLLBACK
--   Restore the four policies' prior bodies (the `OR public.is_super_admin()`
--   variants + the super_admin-only tenants insert/update/delete) from
--   migrations 0002 and 0046, and re-GRANT EXECUTE on is_super_admin() to
--   authenticated (migration 0111).

BEGIN;

-- ============================================================
-- 1. tenants — own-tenant only; provisioning/teardown is platform-only
-- ============================================================

DROP POLICY IF EXISTS tenants_select ON public.tenants;
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (id = ANY (SELECT public.get_user_tenant_ids()));

-- INSERT (create tenant) + DELETE (drop tenant) are PLATFORM ops. No
-- authenticated policy — the service-role client bypasses RLS for these.
DROP POLICY IF EXISTS tenants_insert ON public.tenants;
DROP POLICY IF EXISTS tenants_delete ON public.tenants;

-- A tenant manager may still update THEIR OWN tenant row (rename, etc.).
DROP POLICY IF EXISTS tenants_update ON public.tenants;
CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(id))
  WITH CHECK (public.is_tenant_admin(id));

-- ============================================================
-- 2. tenant_settings / tenant_members — drop the cross-tenant SELECT escape
-- ============================================================

DROP POLICY IF EXISTS tenant_settings_select ON public.tenant_settings;
CREATE POLICY tenant_settings_select ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (SELECT public.get_user_tenant_ids()));

DROP POLICY IF EXISTS tenant_members_select ON public.tenant_members;
CREATE POLICY tenant_members_select ON public.tenant_members
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (SELECT public.get_user_tenant_ids()));

-- ============================================================
-- 3. orphaned_user_assignments (0046) — strip is_super_admin() branches
-- ============================================================

DROP POLICY IF EXISTS orphaned_user_assignments_select ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_select
  ON public.orphaned_user_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR assigned_by = (SELECT auth.uid())
    OR assigned_tenant_id = ANY (SELECT public.get_user_tenant_ids())
  );

DROP POLICY IF EXISTS orphaned_user_assignments_insert ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_insert
  ON public.orphaned_user_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    assigned_by = (SELECT auth.uid())
    AND public.get_user_role(assigned_tenant_id) IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS orphaned_user_assignments_update ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_update
  ON public.orphaned_user_assignments
  FOR UPDATE TO authenticated
  USING (
    assigned_by = (SELECT auth.uid())
    OR public.is_tenant_admin(assigned_tenant_id)
  )
  WITH CHECK (
    assigned_by = (SELECT auth.uid())
    OR public.is_tenant_admin(assigned_tenant_id)
  );

-- ============================================================
-- 4. Neutralise the cross-tenant helper (reversible — not dropped)
-- ============================================================

-- No policy references is_super_admin() after the rewrites above, and no app
-- code calls the RPC. Revoke EXECUTE so a tenant session can never invoke the
-- cross-tenant check. Keep the function defined for reversibility; a follow-up
-- migration DROPs it once live pg_depend confirms nothing else references it.
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM authenticated;

COMMENT ON FUNCTION public.is_super_admin() IS
  'DEPRECATED (migration 0114, C6): cross-tenant check — no longer referenced '
  'by any policy and EXECUTE revoked from authenticated. Cross-tenant power is '
  'out-of-band (service-role / EQ_PLATFORM_ADMIN_KEY), never a tenant role. '
  'Scheduled for DROP in a follow-up once live pg_depend confirms zero refs.';

COMMIT;
