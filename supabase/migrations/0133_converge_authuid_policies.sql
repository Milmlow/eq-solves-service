-- 0133_converge_authuid_policies.sql
--
-- Phase 1/2 — Service identity convergence: re-point the last RLS policies that
-- still key off auth.uid() / inline tenant_members lookups so they route through
-- the claims-aware helpers.
--   Design : docs/identity-convergence-service-adoption.md
--   Sprint : docs/sprint-identity-convergence.md
--   Helpers: migration 0131 (get_user_tenant_ids / get_user_role — claims-aware
--            by tenant_slug, tenant_members fallback) and migration 0132
--            (_current_service_uid — federated email->Service uid, else auth.uid()).
--
-- WHY THIS IS A BEHAVIOURAL NO-OP WHEN THE FLAG IS OFF
-- The 0131/0132 helpers each reduce to the *verbatim* pre-migration logic when
-- public.identity_rollout.claims_enabled is FALSE (seeded false):
--   - get_user_tenant_ids()  -> coalesce(array_agg(tenant_id),'{}') from
--     tenant_members for auth.uid() where is_active  (verified term-for-term
--     identical to the inlined sub-selects below — set-equiv to IN(...))
--   - get_user_role(tid)     -> role from tenant_members for auth.uid()+tid+active
--   - _current_service_uid() -> auth.uid()
-- Every rewrite here substitutes one of those helpers for an expression that is
-- term-for-term identical to the helper's flag-off branch, so a DB built from
-- migrations behaves identically before and after 0133 until someone flips the
-- flag. After the flip, these policies converge onto the federated identity along
-- with the other ~120 helper-routed policies — no further policy edits needed.
--
-- INVARIANT: command (SELECT/INSERT/UPDATE/DELETE/ALL), TO-roles, permissive-ness
-- and access scope are preserved EXACTLY for every policy. Roles shown as `{}`
-- (PUBLIC) are recreated with NO `TO` clause; `{authenticated}` is recreated
-- `TO authenticated`. We use ALTER POLICY throughout, which never touches
-- name/command/roles/permissive — only the USING/WITH CHECK expressions.
--
-- PERFORMANCE NOTE (corrected vs an earlier draft):
--   - _current_service_uid() and get_user_role(<constant>) wrapped in (select ...)
--     are NON-correlated, so the planner hoists them to a single InitPlan
--     (evaluated once per query) per migration 0027 / AGENTS.md.
--   - get_user_role(tenant_id) is CORRELATED on each candidate row's tenant_id, so
--     it is a per-row SubPlan — it is NOT hoisted to an InitPlan. This is perf-
--     NEUTRAL, not perf-improving: the original inlined "tenant_id IN (SELECT ...
--     WHERE role = ANY(...))" was equally per-row correlated. Wrapping it in
--     (select ...) is harmless and kept only for stylistic uniformity.
--   - get_user_tenant_ids() is the ARRAY argument to ANY(...) and MUST stay bare —
--     ANY((select f())) makes f() a scalar uuid[] and Postgres then rejects
--     `uuid = uuid[]` (42883). The bare ANY(get_user_tenant_ids()) is the
--     established working idiom across this schema and the STABLE function is
--     still hoisted to a single InitPlan, so it is not evaluated per row.
--
-- mfa_recovery_codes_select_own is DELIBERATELY LEFT ON auth.uid() — see the
-- note at the end of this file.

-- ════════════════════════════════════════════════════════════════════════════
-- GUARD — fail loudly if 0131/0132 have not been applied first.
-- Live prod is currently pre-0131 (verified 2026-06-14: _current_service_uid()
-- and identity_rollout both absent). A cherry-pick / out-of-order apply of 0133
-- ahead of 0131+0132 would otherwise abort mid-file with a bare 42883. This DO
-- block turns that into a clear, actionable error before any ALTER POLICY runs.
-- ════════════════════════════════════════════════════════════════════════════
DO $guard$
BEGIN
  IF to_regprocedure('public._current_service_uid()') IS NULL THEN
    RAISE EXCEPTION
      'Migration 0133 requires public._current_service_uid() (migration 0132). Apply 0131 + 0132 before 0133.';
  END IF;
  IF to_regclass('public.identity_rollout') IS NULL THEN
    RAISE EXCEPTION
      'Migration 0133 requires public.identity_rollout (migration 0131). Apply 0131 + 0132 before 0133.';
  END IF;
END
$guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- CATEGORY A — tenant-isolation policies that inline the tenant_members lookup.
-- Rewrite to ANY(get_user_tenant_ids()) for tenant scoping (bare — see header)
-- and (select get_user_role(tenant_id)) for the writer/role gate.
-- These all carry roles `{}` (PUBLIC) -> ALTER POLICY preserves command + roles.
-- ════════════════════════════════════════════════════════════════════════════

-- ── contacts (4 policies) ─────────────────────────────────────────────────────
-- Original USING/CHECK inlined `tenant_id IN (SELECT tm.tenant_id FROM
-- tenant_members tm WHERE tm.user_id = (select auth.uid()) AND tm.is_active
-- [AND tm.role = ANY(ARRAY['manager','supervisor'])])`.

ALTER POLICY "Tenant members can read contacts" ON public.contacts
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

ALTER POLICY "Writers can delete contacts" ON public.contacts
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  );

ALTER POLICY "Writers can insert contacts" ON public.contacts
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  );

ALTER POLICY "Writers can update contacts" ON public.contacts
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  )
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  );

-- ── contract_scopes (1 policy, FOR ALL) ───────────────────────────────────────
-- Tenant-isolation only (no role gate). USING-only in the original; FOR ALL with
-- a NULL WITH CHECK falls back to the USING expression for INSERT/UPDATE, so we
-- preserve that by altering USING only.
ALTER POLICY "Tenant isolation" ON public.contract_scopes
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

-- ── customer_contacts (read + writers-manage) ─────────────────────────────────
ALTER POLICY "Tenant members can read customer contacts" ON public.customer_contacts
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

ALTER POLICY "Writers can manage customer contacts" ON public.customer_contacts
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  )
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  );

-- ── site_contacts (read + writers-manage) ─────────────────────────────────────
ALTER POLICY "Tenant members can read site contacts" ON public.site_contacts
  USING (tenant_id = ANY (public.get_user_tenant_ids()));

ALTER POLICY "Writers can manage site contacts" ON public.site_contacts
  USING (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  )
  WITH CHECK (
    tenant_id = ANY (public.get_user_tenant_ids())
    AND (select public.get_user_role(tenant_id)) = ANY (ARRAY['manager'::text, 'supervisor'::text])
  );

-- ── app_settings (app_settings_admin_all, FOR ALL) ───────────────────────────
-- app_settings is a GLOBAL key/value table (no tenant_id column). The original
-- admin gate is "is this user an active manager in ANY tenant":
--     EXISTS (SELECT 1 FROM tenant_members tm
--             WHERE tm.user_id = auth.uid() AND tm.is_active AND tm.role='manager')
-- Convergent rewrite: the user is a manager in at least one of their resolved
-- tenants. Flag OFF this is term-for-term the same set (get_user_tenant_ids() =
-- the user's active tenant_ids; get_user_role(tid) = their role there). The set
-- equivalence is STRUCTURALLY guaranteed, not merely true-today: the unconditional
-- UNIQUE index tenant_members_tenant_id_user_id_key on (tenant_id, user_id) means
-- a user has at most one row per tenant, so get_user_role's LIMIT 1 can never mask
-- a second active role. Flag ON it becomes "eq_role claim = manager" for the
-- federated tenant — the intended convergent behaviour. roles `{}` -> no TO clause.
ALTER POLICY app_settings_admin_all ON public.app_settings
  USING (
    EXISTS (
      SELECT 1
      FROM unnest(public.get_user_tenant_ids()) AS t(tid)
      WHERE (select public.get_user_role(t.tid)) = 'manager'::text
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- CATEGORY B — own-record policies keyed on user_id / id / assigned_by =
-- auth.uid(). Replace auth.uid() with (select public._current_service_uid()).
-- ════════════════════════════════════════════════════════════════════════════

-- ── access_requests (cancel own / insert own / select own) — TO authenticated ─
ALTER POLICY "access_requests: cancel own" ON public.access_requests
  USING (user_id = (select public._current_service_uid()))
  WITH CHECK (user_id = (select public._current_service_uid()));

ALTER POLICY "access_requests: insert own" ON public.access_requests
  WITH CHECK (user_id = (select public._current_service_uid()));

ALTER POLICY "access_requests: select own" ON public.access_requests
  USING (user_id = (select public._current_service_uid()));

-- ── notifications (see own / update own) — roles `{}` (PUBLIC), no TO clause ──
ALTER POLICY "Users see own notifications" ON public.notifications
  USING (user_id = (select public._current_service_uid()));

ALTER POLICY "Users update own notifications" ON public.notifications
  USING (user_id = (select public._current_service_uid()))
  WITH CHECK (user_id = (select public._current_service_uid()));

-- ── orphaned_user_assignments — CONVERT ALL THREE SIBLINGS CONSISTENTLY ───────
-- FIX (was a half-conversion in the draft): all three policies key on the SAME
-- assigned_by / user_id self-reference and MUST share one uid namespace. Live defs
-- (verified 2026-06-14):
--   _insert  WITH CHECK ((assigned_by = (select auth.uid())) AND
--                        (get_user_role(assigned_tenant_id) = 'manager'))
--   _select  USING ((user_id = (select auth.uid())) OR
--                   (assigned_by = (select auth.uid())) OR
--                   (assigned_tenant_id = ANY (get_user_tenant_ids())))
--   _update  USING/CHECK (assigned_by = (select auth.uid()))
-- Converting only _update would let a federated manager INSERT a row stamped with
-- their canonical id (insert unchanged) that the converted _update (Service id)
-- could never match — a latent post-flip correctness defect. We move every
-- auth.uid() self-reference on this table to _current_service_uid() so insert,
-- update, and select agree. The get_user_role / get_user_tenant_ids terms already
-- route through the helpers and are left exactly as-is. Flag OFF: all forms reduce
-- to auth.uid(), so this is a no-op today.
ALTER POLICY orphaned_user_assignments_insert ON public.orphaned_user_assignments
  WITH CHECK (
    assigned_by = (select public._current_service_uid())
    AND public.get_user_role(assigned_tenant_id) = 'manager'::text
  );

ALTER POLICY orphaned_user_assignments_select ON public.orphaned_user_assignments
  USING (
    user_id = (select public._current_service_uid())
    OR assigned_by = (select public._current_service_uid())
    OR assigned_tenant_id = ANY (public.get_user_tenant_ids())
  );

ALTER POLICY orphaned_user_assignments_update ON public.orphaned_user_assignments
  USING (assigned_by = (select public._current_service_uid()))
  WITH CHECK (assigned_by = (select public._current_service_uid()));

-- ── profiles (select own / update own, keyed on id) — TO authenticated ────────
-- Original profiles_select_own USING: (id = auth.uid()).
ALTER POLICY profiles_select_own ON public.profiles
  USING (id = (select public._current_service_uid()));

-- Original profiles_update_own:
--   USING (id = auth.uid())
--   CHECK ((id = auth.uid()) AND (role = (SELECT role FROM profiles WHERE id = auth.uid())))
-- The CHECK pins role to the row owner's current role (prevents self role-escalation).
-- Every auth.uid() — including the one inside the role-pin sub-select — moves to
-- _current_service_uid() so the federated session pins to ITS OWN Service profile.
ALTER POLICY profiles_update_own ON public.profiles
  USING (id = (select public._current_service_uid()))
  WITH CHECK (
    id = (select public._current_service_uid())
    AND role = (
      SELECT p.role FROM public.profiles p
      WHERE p.id = (select public._current_service_uid())
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- mfa_recovery_codes_select_own — INTENTIONALLY NOT CHANGED.
--
-- DECISION: leave this policy keyed on the raw auth.uid(), NOT _current_service_uid().
-- Rationale (security-sensitive, flagged per task):
--   - MFA recovery codes are the highest-blast-radius secret in the table set.
--     Re-keying their visibility through an email-claim->uid mapping widens the
--     trust surface to the federated email claim; a wrong/spoofed email claim
--     could expose another user's recovery codes. auth.uid() is cryptographically
--     bound to the verified Supabase session and cannot be steered by a claim.
--   - Federated (Shell) users perform MFA via the Shell, not via Service — they
--     never read Service mfa_recovery_codes — so routing this through the
--     federated-uid mapper buys no functionality, only risk. Post-flip a federated
--     session's canonical auth.uid() matches no Service user_id, so it fails CLOSED
--     (returns nothing) for users who never read these codes anyway. Direct-login
--     Service users (the only ones who use these codes) already have auth.uid() =
--     their Service uid, so auth.uid() is exactly right for them.
-- Net: keeping auth.uid() here is strictly the safer choice and loses nothing.
-- (Note: it is also currently UNWRAPPED — `(user_id = auth.uid())`. We leave it
-- byte-for-byte as-is to avoid any behavioural change on an MFA path; an optional
-- (select auth.uid()) initplan wrap is a separate, non-convergence perf tweak.)
-- ════════════════════════════════════════════════════════════════════════════