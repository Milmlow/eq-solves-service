-- =============================================================================
-- Migration 0114: Canonical role rename + tenant isolation (C6 Half B)
-- =============================================================================
--
-- EQ Service adopts the canonical EQ role vocabulary (@eq-solutions/roles) at
-- the database level, and the cross-tenant `super_admin` power is removed so
-- tenants are fully isolated.
--
-- Vocabulary change (full canonical):
--     super_admin → manager     (tenant admin)
--     admin       → manager     (MERGE — the two tenant-admin tiers collapse;
--                                the distinction was only meaningful while
--                                super_admin was cross-tenant, which it no
--                                longer is)
--     supervisor  → supervisor  (unchanged)
--     technician  → employee
--     read_only   → apprentice
--   Canonical also defines `labour_hire` (accepted, unused in Service today).
--
-- Isolation fix:
--   * `is_super_admin()` (no tenant arg) was the ONLY cross-tenant grant. Every
--     other check is already tenant-scoped. It is removed entirely.
--   * `tenants` writes move OUT of the authenticated RLS surface — tenant
--     provisioning is service-role only, via an EQ-internal endpoint
--     (`/api/tenants`, gated by a platform secret). The authenticated
--     INSERT/UPDATE/DELETE policies on `tenants` are dropped.
--   * `tenants` / `tenant_settings` / `tenant_members` SELECT lose their
--     `OR is_super_admin()` escape — users see only their own tenant(s).
--   * `orphaned_user_assignments` policies drop every `is_super_admin()` clause.
--
-- Deliberately NOT touched:
--   * `is_admin()` (profiles.role = 'admin') is already effectively dead — no
--     profile has role='admin' (admins are seeded as super_admin), so the
--     profiles "admin can manage all profiles" policy already grants only
--     self-access in practice. Leaving it as-is preserves that behaviour AND
--     avoids reintroducing a cross-tenant profile leak (profiles has no
--     tenant_id, so a live is_admin() would be cross-tenant). Profile role
--     changes continue to flow through the service-role (setRoleAction).
--   * `is_tenant_admin()`-only policies (customers, sites, assets, job_plans,
--     job_plan_items, tenant_settings/members writes, etc.) are NOT rewritten —
--     the function body change below covers them.
--
-- This is an AUTH change. Tested on a Supabase branch before any prod apply.
-- Pairs with the app-layer role-vocab sweep in the same PR; DB + app must
-- deploy together.
-- =============================================================================

-- =============================================================================
-- 1. Role data + CHECK constraints → canonical vocabulary
-- =============================================================================

ALTER TABLE public.tenant_members            DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.profiles                  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.orphaned_user_assignments DROP CONSTRAINT IF EXISTS orphaned_user_assignments_assigned_role_check;

UPDATE public.tenant_members SET role = CASE role
    WHEN 'super_admin' THEN 'manager'
    WHEN 'admin'       THEN 'manager'
    WHEN 'technician'  THEN 'employee'
    WHEN 'read_only'   THEN 'apprentice'
    ELSE role
  END
WHERE role IN ('super_admin','admin','technician','read_only');

UPDATE public.profiles SET role = CASE role
    WHEN 'super_admin' THEN 'manager'
    WHEN 'admin'       THEN 'manager'
    WHEN 'technician'  THEN 'employee'
    WHEN 'read_only'   THEN 'apprentice'
    WHEN 'user'        THEN 'apprentice'
    ELSE role
  END
WHERE role IN ('super_admin','admin','technician','read_only','user');

UPDATE public.orphaned_user_assignments SET assigned_role = CASE assigned_role
    WHEN 'super_admin' THEN 'manager'
    WHEN 'admin'       THEN 'manager'
    WHEN 'technician'  THEN 'employee'
    WHEN 'read_only'   THEN 'apprentice'
    ELSE assigned_role
  END
WHERE assigned_role IN ('super_admin','admin','technician','read_only');

-- Default for new profiles rows was 'user' (legacy). Align with the trigger's
-- new default so a role-less insert is canonical-valid.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'employee';

ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('manager','supervisor','employee','apprentice','labour_hire'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('manager','supervisor','employee','apprentice','labour_hire'));

ALTER TABLE public.orphaned_user_assignments
  ADD CONSTRAINT orphaned_user_assignments_assigned_role_check
  CHECK (assigned_role IN ('manager','supervisor','employee','apprentice','labour_hire'));

-- =============================================================================
-- 2. Helper + trigger functions → canonical vocabulary
--    (CREATE OR REPLACE preserves the search_path hardening + grants from 0111)
-- =============================================================================

-- Tenant admin is now the single canonical `manager` (was super_admin/admin).
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
      AND role = 'manager' AND is_active = true
  );
$$;

-- Signup trigger: default new users to employee; seed EQ-internal emails as
-- managers (was technician / super_admin).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := 'employee';
  v_admin_emails text[] := ARRAY['dev@eq.solutions','royce@eq.solutions'];
BEGIN
  IF new.email = ANY(v_admin_emails) THEN
    v_role := 'manager';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (
      new.id,
      new.email,
      COALESCE(new.raw_user_meta_data->>'full_name',''),
      v_role,
      true
    )
    ON CONFLICT (id) DO UPDATE
      SET email     = EXCLUDED.email,
          full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: failed to upsert profile for % (%): %', new.email, new.id, SQLERRM;
  END;

  RETURN new;
END;
$function$;

-- Supervisor-digest helpers: supervisor/admin/super_admin → supervisor/manager.
CREATE OR REPLACE FUNCTION public.list_active_supervisors()
RETURNS TABLE(tenant_id uuid, user_id uuid, email text, full_name text, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    tm.tenant_id,
    tm.user_id,
    p.email,
    p.full_name,
    tm.role
  FROM public.tenant_members tm
  JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.is_active = true
    AND p.is_active = true
    AND tm.role IN ('supervisor', 'manager')
    AND p.email IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.pm_calendar_for_supervisor(p_supervisor_user_id uuid, p_tenant_id uuid, p_horizon_days integer DEFAULT 14)
RETURNS TABLE(id uuid, site_id uuid, site_name text, site_code text, customer_name text, title text, category text, location text, start_time timestamp with time zone, end_time timestamp with time zone, status text, assigned_to uuid, assigned_to_name text, bucket text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_now timestamptz := now();
  v_today_start timestamptz := date_trunc('day', v_now);
  v_today_end timestamptz := v_today_start + interval '1 day';
  v_this_week_end timestamptz := v_today_start + interval '7 days';
  v_horizon_end timestamptz := v_today_start + (p_horizon_days || ' days')::interval;
BEGIN
  SELECT tm.role INTO v_role
  FROM public.tenant_members tm
  WHERE tm.user_id = p_supervisor_user_id
    AND tm.tenant_id = p_tenant_id
    AND tm.is_active = true
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('supervisor', 'manager') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pc.id,
    pc.site_id,
    s.name AS site_name,
    s.code AS site_code,
    c.name AS customer_name,
    pc.title,
    pc.category,
    pc.location,
    pc.start_time,
    pc.end_time,
    pc.status,
    pc.assigned_to,
    p.full_name AS assigned_to_name,
    CASE
      WHEN pc.start_time <  v_today_start                                  THEN 'overdue'
      WHEN pc.start_time >= v_today_start AND pc.start_time < v_today_end  THEN 'today'
      WHEN pc.start_time <  v_this_week_end                                THEN 'this_week'
      ELSE                                                                       'next_week'
    END AS bucket
  FROM public.pm_calendar pc
  LEFT JOIN public.sites s     ON s.id = pc.site_id
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.profiles p  ON p.id = pc.assigned_to
  WHERE pc.tenant_id = p_tenant_id
    AND pc.is_active = true
    AND pc.status IN ('scheduled', 'in_progress')
    AND (
      pc.start_time < v_today_start
      OR pc.start_time < v_horizon_end
    )
  ORDER BY
    CASE
      WHEN pc.start_time <  v_today_start THEN 0
      WHEN pc.start_time <  v_today_end   THEN 1
      WHEN pc.start_time <  v_this_week_end THEN 2
      ELSE 3
    END,
    pc.start_time ASC;
END;
$function$;

-- Scope-coverage-gap accept gate: super_admin/admin → manager.
CREATE OR REPLACE FUNCTION public.enforce_scope_coverage_gap_accept_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF (OLD.accepted_at IS DISTINCT FROM NEW.accepted_at)
     OR (OLD.accepted_by IS DISTINCT FROM NEW.accepted_by)
     OR (OLD.accepted_reason IS DISTINCT FROM NEW.accepted_reason)
     OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'accepted')
  THEN
    v_role := public.get_user_role(NEW.tenant_id);
    IF v_role <> 'manager' OR v_role IS NULL THEN
      RAISE EXCEPTION 'role % cannot accept a scope coverage gap; manager required', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Contract-scope lock bypass: super_admin → manager.
CREATE OR REPLACE FUNCTION public.enforce_contract_scope_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role      text;
  v_tenant_id uuid := COALESCE(OLD.tenant_id, NEW.tenant_id);
BEGIN
  IF NOT public.tenant_has_commercial_features(v_tenant_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_role := public.get_user_role(v_tenant_id);
  IF v_role = 'manager' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.period_status = 'locked' THEN
      RAISE EXCEPTION 'contract_scopes row % (jp_code=%, year=%) is locked. Unlock via a manager first.',
        OLD.id, OLD.jp_code, OLD.financial_year USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.period_status = 'locked' THEN
      RAISE EXCEPTION 'contract_scopes row % (jp_code=%, year=%) is locked and cannot be deleted. Unlock via a manager first.',
        OLD.id, OLD.jp_code, OLD.financial_year USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- =============================================================================
-- 3. RLS policy rewrites — role-list policies
--    (generated from pg_policies with the canonical substitution applied;
--     is_tenant_admin-only and is_super_admin policies handled elsewhere)
-- =============================================================================

DROP POLICY IF EXISTS acb_readings_delete ON public.acb_test_readings;
CREATE POLICY acb_readings_delete ON public.acb_test_readings FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS acb_readings_insert ON public.acb_test_readings;
CREATE POLICY acb_readings_insert ON public.acb_test_readings FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS acb_tests_delete ON public.acb_tests;
CREATE POLICY acb_tests_delete ON public.acb_tests FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS acb_tests_insert ON public.acb_tests;
CREATE POLICY acb_tests_insert ON public.acb_tests FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS acb_tests_update ON public.acb_tests;
CREATE POLICY acb_tests_update ON public.acb_tests FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS app_settings_admin_all ON public.app_settings;
CREATE POLICY app_settings_admin_all ON public.app_settings FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM tenant_members tm
  WHERE ((tm.user_id = auth.uid()) AND (tm.is_active = true) AND (tm.role = 'manager'::text)))));

DROP POLICY IF EXISTS attachments_delete ON public.attachments;
CREATE POLICY attachments_delete ON public.attachments FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS attachments_insert ON public.attachments;
CREATE POLICY attachments_insert ON public.attachments FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS "Admin can delete check_assets" ON public.check_assets;
CREATE POLICY "Admin can delete check_assets" ON public.check_assets FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = check_assets.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text])))))));

DROP POLICY IF EXISTS "Writers can delete contacts" ON public.contacts;
CREATE POLICY "Writers can delete contacts" ON public.contacts FOR DELETE TO public
  USING ((tenant_id IN ( SELECT tm.tenant_id
   FROM tenant_members tm
  WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.is_active = true) AND (tm.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))));

DROP POLICY IF EXISTS "Writers can insert contacts" ON public.contacts;
CREATE POLICY "Writers can insert contacts" ON public.contacts FOR INSERT TO public
  WITH CHECK ((tenant_id IN ( SELECT tm.tenant_id
   FROM tenant_members tm
  WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.is_active = true) AND (tm.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))));

DROP POLICY IF EXISTS "Writers can update contacts" ON public.contacts;
CREATE POLICY "Writers can update contacts" ON public.contacts FOR UPDATE TO public
  USING ((tenant_id IN ( SELECT tm.tenant_id
   FROM tenant_members tm
  WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.is_active = true) AND (tm.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))))
  WITH CHECK ((tenant_id IN ( SELECT tm.tenant_id
   FROM tenant_members tm
  WHERE ((tm.user_id = ( SELECT auth.uid() AS uid)) AND (tm.is_active = true) AND (tm.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))));

DROP POLICY IF EXISTS contract_scopes_history_select ON public.contract_scopes_history;
CREATE POLICY contract_scopes_history_select ON public.contract_scopes_history FOR SELECT TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS contract_variations_delete ON public.contract_variations;
CREATE POLICY contract_variations_delete ON public.contract_variations FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS contract_variations_insert ON public.contract_variations;
CREATE POLICY contract_variations_insert ON public.contract_variations FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS contract_variations_update ON public.contract_variations;
CREATE POLICY contract_variations_update ON public.contract_variations FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS "Writers can manage customer contacts" ON public.customer_contacts;
CREATE POLICY "Writers can manage customer contacts" ON public.customer_contacts FOR ALL TO public
  USING ((tenant_id IN ( SELECT tenant_members.tenant_id
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))))
  WITH CHECK ((tenant_id IN ( SELECT tenant_members.tenant_id
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))));

DROP POLICY IF EXISTS customer_notification_preferences_delete ON public.customer_notification_preferences;
CREATE POLICY customer_notification_preferences_delete ON public.customer_notification_preferences FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS customer_notification_preferences_insert ON public.customer_notification_preferences;
CREATE POLICY customer_notification_preferences_insert ON public.customer_notification_preferences FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS customer_notification_preferences_update ON public.customer_notification_preferences;
CREATE POLICY customer_notification_preferences_update ON public.customer_notification_preferences FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS "writers update defects" ON public.defects;
CREATE POLICY "writers update defects" ON public.defects FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND ((get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text])) OR (assigned_to = ( SELECT auth.uid() AS uid)))));

DROP POLICY IF EXISTS import_overrides_delete ON public.import_overrides;
CREATE POLICY import_overrides_delete ON public.import_overrides FOR DELETE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS import_overrides_insert ON public.import_overrides;
CREATE POLICY import_overrides_insert ON public.import_overrides FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text])) AND (created_by = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS import_overrides_update ON public.import_overrides;
CREATE POLICY import_overrides_update ON public.import_overrides FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS import_sessions_insert ON public.import_sessions;
CREATE POLICY import_sessions_insert ON public.import_sessions FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text])) AND (created_by = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS import_sessions_update ON public.import_sessions;
CREATE POLICY import_sessions_update ON public.import_sessions FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS instruments_delete ON public.instruments;
CREATE POLICY instruments_delete ON public.instruments FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS instruments_insert ON public.instruments;
CREATE POLICY instruments_insert ON public.instruments FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS instruments_update ON public.instruments;
CREATE POLICY instruments_update ON public.instruments FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS job_plan_aliases_insert ON public.job_plan_aliases;
CREATE POLICY job_plan_aliases_insert ON public.job_plan_aliases FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text])) AND (created_by = ( SELECT auth.uid() AS uid))));

DROP POLICY IF EXISTS job_plan_aliases_update ON public.job_plan_aliases;
CREATE POLICY job_plan_aliases_update ON public.job_plan_aliases FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS "Admin can delete check items" ON public.maintenance_check_items;
CREATE POLICY "Admin can delete check items" ON public.maintenance_check_items FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = maintenance_check_items.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text])))))));

DROP POLICY IF EXISTS "Admin and supervisor can create check items" ON public.maintenance_check_items;
CREATE POLICY "Admin and supervisor can create check items" ON public.maintenance_check_items FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = maintenance_check_items.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text])))))));

DROP POLICY IF EXISTS "Write roles and assigned technicians can update check items" ON public.maintenance_check_items;
CREATE POLICY "Write roles and assigned technicians can update check items" ON public.maintenance_check_items FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND ((EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = maintenance_check_items.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))) OR (EXISTS ( SELECT 1
   FROM maintenance_checks mc
  WHERE ((mc.id = maintenance_check_items.check_id) AND (mc.assigned_to = auth.uid())))))));

DROP POLICY IF EXISTS "Admin can delete checks" ON public.maintenance_checks;
CREATE POLICY "Admin can delete checks" ON public.maintenance_checks FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = maintenance_checks.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text])))))));

DROP POLICY IF EXISTS "Writers can create checks" ON public.maintenance_checks;
CREATE POLICY "Writers can create checks" ON public.maintenance_checks FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = maintenance_checks.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text])))))));

DROP POLICY IF EXISTS "Write roles and assigned technicians can update checks" ON public.maintenance_checks;
CREATE POLICY "Write roles and assigned technicians can update checks" ON public.maintenance_checks FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND ((EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = maintenance_checks.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))) OR (assigned_to = auth.uid()))));

DROP POLICY IF EXISTS "Admins can delete media" ON public.media_library;
CREATE POLICY "Admins can delete media" ON public.media_library FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS "Writers can insert media" ON public.media_library;
CREATE POLICY "Writers can insert media" ON public.media_library FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS "Writers can update media" ON public.media_library;
CREATE POLICY "Writers can update media" ON public.media_library FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS notification_preferences_delete ON public.notification_preferences;
CREATE POLICY notification_preferences_delete ON public.notification_preferences FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS notification_preferences_insert ON public.notification_preferences;
CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND ((user_id = auth.uid()) OR ((user_id IS NULL) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))))));

DROP POLICY IF EXISTS notification_preferences_select ON public.notification_preferences;
CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND ((user_id = auth.uid()) OR (user_id IS NULL) OR (get_user_role(tenant_id) = ANY (ARRAY['manager'::text])))));

DROP POLICY IF EXISTS notification_preferences_update ON public.notification_preferences;
CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND ((user_id = auth.uid()) OR ((user_id IS NULL) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))))));

DROP POLICY IF EXISTS nsx_readings_delete ON public.nsx_test_readings;
CREATE POLICY nsx_readings_delete ON public.nsx_test_readings FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS nsx_readings_insert ON public.nsx_test_readings;
CREATE POLICY nsx_readings_insert ON public.nsx_test_readings FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS nsx_tests_delete ON public.nsx_tests;
CREATE POLICY nsx_tests_delete ON public.nsx_tests FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS nsx_tests_insert ON public.nsx_tests;
CREATE POLICY nsx_tests_insert ON public.nsx_tests FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS nsx_tests_update ON public.nsx_tests;
CREATE POLICY nsx_tests_update ON public.nsx_tests FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS pm_calendar_delete ON public.pm_calendar;
CREATE POLICY pm_calendar_delete ON public.pm_calendar FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS pm_calendar_insert ON public.pm_calendar;
CREATE POLICY pm_calendar_insert ON public.pm_calendar FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS pm_calendar_update ON public.pm_calendar;
CREATE POLICY pm_calendar_update ON public.pm_calendar FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS rcd_test_circuits_delete ON public.rcd_test_circuits;
CREATE POLICY rcd_test_circuits_delete ON public.rcd_test_circuits FOR DELETE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS rcd_test_circuits_insert ON public.rcd_test_circuits;
CREATE POLICY rcd_test_circuits_insert ON public.rcd_test_circuits FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS rcd_test_circuits_update ON public.rcd_test_circuits;
CREATE POLICY rcd_test_circuits_update ON public.rcd_test_circuits FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS rcd_tests_delete ON public.rcd_tests;
CREATE POLICY rcd_tests_delete ON public.rcd_tests FOR DELETE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS rcd_tests_insert ON public.rcd_tests;
CREATE POLICY rcd_tests_insert ON public.rcd_tests FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS rcd_tests_update ON public.rcd_tests;
CREATE POLICY rcd_tests_update ON public.rcd_tests FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS "writers issue deliveries" ON public.report_deliveries;
CREATE POLICY "writers issue deliveries" ON public.report_deliveries FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS "supervisors revoke deliveries" ON public.report_deliveries;
CREATE POLICY "supervisors revoke deliveries" ON public.report_deliveries FOR UPDATE TO authenticated
  USING ((tenant_id = ANY (get_user_tenant_ids())))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS scope_coverage_gaps_delete ON public.scope_coverage_gaps;
CREATE POLICY scope_coverage_gaps_delete ON public.scope_coverage_gaps FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS scope_coverage_gaps_insert ON public.scope_coverage_gaps;
CREATE POLICY scope_coverage_gaps_insert ON public.scope_coverage_gaps FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS scope_coverage_gaps_update ON public.scope_coverage_gaps;
CREATE POLICY scope_coverage_gaps_update ON public.scope_coverage_gaps FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS "Writers can manage site contacts" ON public.site_contacts;
CREATE POLICY "Writers can manage site contacts" ON public.site_contacts FOR ALL TO public
  USING ((tenant_id IN ( SELECT tenant_members.tenant_id
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))))
  WITH CHECK ((tenant_id IN ( SELECT tenant_members.tenant_id
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text]))))));

DROP POLICY IF EXISTS site_credentials_delete ON public.site_credentials;
CREATE POLICY site_credentials_delete ON public.site_credentials FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS site_credentials_insert ON public.site_credentials;
CREATE POLICY site_credentials_insert ON public.site_credentials FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS site_credentials_select ON public.site_credentials;
CREATE POLICY site_credentials_select ON public.site_credentials FOR SELECT TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS site_credentials_update ON public.site_credentials;
CREATE POLICY site_credentials_update ON public.site_credentials FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text]))));

DROP POLICY IF EXISTS "Admin can delete readings" ON public.test_record_readings;
CREATE POLICY "Admin can delete readings" ON public.test_record_readings FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = test_record_readings.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text])))))));

DROP POLICY IF EXISTS "Write roles can create readings" ON public.test_record_readings;
CREATE POLICY "Write roles can create readings" ON public.test_record_readings FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = test_record_readings.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text])))))));

DROP POLICY IF EXISTS "Write roles can update readings" ON public.test_record_readings;
CREATE POLICY "Write roles can update readings" ON public.test_record_readings FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = test_record_readings.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text])))))));

DROP POLICY IF EXISTS "Admin can delete test records" ON public.test_records;
CREATE POLICY "Admin can delete test records" ON public.test_records FOR DELETE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = test_records.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text])))))));

DROP POLICY IF EXISTS "Write roles can create test records" ON public.test_records;
CREATE POLICY "Write roles can create test records" ON public.test_records FOR INSERT TO public
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = test_records.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text])))))));

DROP POLICY IF EXISTS "Write roles can update test records" ON public.test_records;
CREATE POLICY "Write roles can update test records" ON public.test_records FOR UPDATE TO public
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (EXISTS ( SELECT 1
   FROM tenant_members
  WHERE ((tenant_members.user_id = auth.uid()) AND (tenant_members.tenant_id = test_records.tenant_id) AND (tenant_members.is_active = true) AND (tenant_members.role = ANY (ARRAY['manager'::text, 'supervisor'::text])))))));

DROP POLICY IF EXISTS thermal_scan_findings_delete ON public.thermal_scan_findings;
CREATE POLICY thermal_scan_findings_delete ON public.thermal_scan_findings FOR DELETE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS thermal_scan_findings_insert ON public.thermal_scan_findings;
CREATE POLICY thermal_scan_findings_insert ON public.thermal_scan_findings FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS thermal_scan_findings_update ON public.thermal_scan_findings;
CREATE POLICY thermal_scan_findings_update ON public.thermal_scan_findings FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS thermal_scans_delete ON public.thermal_scans;
CREATE POLICY thermal_scans_delete ON public.thermal_scans FOR DELETE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text]))));

DROP POLICY IF EXISTS thermal_scans_insert ON public.thermal_scans;
CREATE POLICY thermal_scans_insert ON public.thermal_scans FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

DROP POLICY IF EXISTS thermal_scans_update ON public.thermal_scans;
CREATE POLICY thermal_scans_update ON public.thermal_scans FOR UPDATE TO authenticated
  USING (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))))
  WITH CHECK (((tenant_id = ANY (get_user_tenant_ids())) AND (get_user_role(tenant_id) = ANY (ARRAY['manager'::text, 'supervisor'::text, 'employee'::text]))));

-- =============================================================================
-- 4. Remove cross-tenant power (the isolation fix)
-- =============================================================================

-- tenants: provisioning is service-role only now (the EQ-internal /api/tenants
-- endpoint uses the service-role key, which bypasses RLS). No authenticated
-- write path remains, and SELECT is scoped to the caller's own tenant(s).
DROP POLICY IF EXISTS tenants_insert ON public.tenants;
DROP POLICY IF EXISTS tenants_update ON public.tenants;
DROP POLICY IF EXISTS tenants_delete ON public.tenants;
DROP POLICY IF EXISTS tenants_select ON public.tenants;
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (id = ANY (public.get_user_tenant_ids()));

DROP POLICY IF EXISTS tenant_settings_select ON public.tenant_settings;
CREATE POLICY tenant_settings_select ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

DROP POLICY IF EXISTS tenant_members_select ON public.tenant_members;
CREATE POLICY tenant_members_select ON public.tenant_members
  FOR SELECT TO authenticated
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

-- orphaned_user_assignments: drop every is_super_admin() escape. Tenant-scoped
-- managers (and the assigner / the assigned user) only.
DROP POLICY IF EXISTS orphaned_user_assignments_select ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_select ON public.orphaned_user_assignments
  FOR SELECT TO authenticated
  USING (
    (user_id = ( SELECT auth.uid() AS uid))
    OR (assigned_by = ( SELECT auth.uid() AS uid))
    OR (assigned_tenant_id = ANY (public.get_user_tenant_ids()))
  );

DROP POLICY IF EXISTS orphaned_user_assignments_insert ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_insert ON public.orphaned_user_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    (assigned_by = ( SELECT auth.uid() AS uid))
    AND (public.get_user_role(assigned_tenant_id) = 'manager')
  );

DROP POLICY IF EXISTS orphaned_user_assignments_update ON public.orphaned_user_assignments;
CREATE POLICY orphaned_user_assignments_update ON public.orphaned_user_assignments
  FOR UPDATE TO authenticated
  USING (assigned_by = ( SELECT auth.uid() AS uid))
  WITH CHECK (assigned_by = ( SELECT auth.uid() AS uid));

-- =============================================================================
-- 5. Drop the cross-tenant helper (now unreferenced)
-- =============================================================================
-- Errors loudly if any policy still references it — a built-in safety check
-- that section 4 was complete.
DROP FUNCTION IF EXISTS public.is_super_admin();

COMMENT ON CONSTRAINT tenant_members_role_check ON public.tenant_members IS
  'Canonical EQ roles (migration 0114). super_admin/admin merged into manager; technician->employee; read_only->apprentice.';
