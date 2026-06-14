-- 0131_identity_claims_aware_helpers.sql
--
-- Phase 1 — Service identity convergence.
--   Design : docs/identity-convergence-service-adoption.md
--   Sprint : docs/sprint-identity-convergence.md
--
-- Teaches the two RLS helper functions to resolve identity from the federated
-- JWT claims — the way EQ Field already does — instead of Service's own
-- tenant_members table. 120 of 167 RLS policies route through these two
-- functions, so re-pointing them converges the bulk of RLS with ZERO policy edits.
--
-- SAFE BY DEFAULT. Behaviour is gated by public.identity_rollout.claims_enabled,
-- seeded FALSE. Applying this migration is a behavioural NO-OP: the helpers keep
-- using tenant_members verbatim (the `else` branch below is byte-for-byte the
-- pre-migration logic) until someone flips the flag. Post-flip rollback is a
-- single UPDATE (instant), not a migration.
--
-- ADVERSARIAL REVIEW FIXES (2026-06-14, run wf_bd13b9f8-f67):
--   [CRITICAL] Tenant resolved by SLUG, never by the raw app_metadata.tenant_id
--     claim. Canonical and Service use DIFFERENT tenant-ID namespaces and they
--     can collide (e.g. a0000000… = "EQ Solutions" canonically but "Demo
--     Electrical" in Service) — casting the canonical id into a Service tenants.id
--     would be a cross-tenant data-exposure bug. We map tenant_slug → tenants.id.
--   [CRITICAL] No `::uuid` cast on any claim value, so a malformed/empty claim
--     can never raise 22P02 and abort every helper-gated query. slug is text;
--     empty/missing claims nullif to NULL and fall through to tenant_members.
--
-- STILL OUTSTANDING (review HIGH, not fixed here — needs uid reconciliation):
--   eq_role is taken from the claim without a DB cross-check. Before flip, gate
--   the role on membership / LEAST(claimed, actual). See sprint Phase 2.
--
-- DO NOT cut over in prod until the shadow-run equivalence check (sprint Rigor
-- track) reports ZERO divergence on a Supabase branch.

-- ── Rollout flag — instant, reversible kill-switch ────────────────────────────
create table if not exists public.identity_rollout (
  id             boolean     primary key default true,
  claims_enabled boolean     not null default false,
  updated_at     timestamptz not null default now(),
  constraint identity_rollout_singleton check (id)
);

insert into public.identity_rollout (id, claims_enabled)
  values (true, false)
  on conflict (id) do nothing;

alter table public.identity_rollout enable row level security;
-- Service-role only: no tenant user reads or writes this control row.
-- No policies = deny-all for authenticated/anon; service_role bypasses RLS.
-- The helper functions below read it via SECURITY DEFINER, so RLS here does not
-- block them.

comment on table public.identity_rollout is
  'Singleton kill-switch for claims-based identity (Phase 1 convergence). Flip claims_enabled TRUE to cut the two RLS helpers over from tenant_members to JWT app_metadata claims; flip back for instant rollback.';

-- ── Resolve THIS session's Service tenant id from the slug claim ──────────────
-- Map app_metadata.tenant_slug → public.tenants.id. We deliberately do NOT trust
-- the raw app_metadata.tenant_id claim (canonical namespace ≠ Service namespace;
-- ids can collide across registries). Returns NULL when the claim is absent or
-- the slug maps to no active Service tenant — callers then fall through safely.
-- No uuid cast of claim data anywhere here (slug is text), so this cannot raise.
create or replace function public._claim_service_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from public.tenants t
  where t.is_active
    and t.slug = nullif(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb
        -> 'app_metadata' ->> 'tenant_slug', '')
  limit 1;
$$;

comment on function public._claim_service_tenant_id() is
  'Phase 1 convergence: the current federated session''s Service tenants.id, resolved from the app_metadata.tenant_slug claim (never the raw tenant_id claim — namespaces differ/collide). NULL when no claim or unknown slug.';

-- ── Are we resolving identity from claims this session? ───────────────────────
-- TRUE only when (a) the flag is on AND (b) the slug claim resolves to a real
-- active Service tenant. Direct-login / service-role / unknown-slug sessions fall
-- through to tenant_members, so the cutover is gradual and never grants access on
-- an unrecognised tenant.
create or replace function public._identity_use_claims()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select claims_enabled from public.identity_rollout where id), false)
    and public._claim_service_tenant_id() is not null;
$$;

comment on function public._identity_use_claims() is
  'Phase 1 convergence: whether to resolve tenant/role from JWT claims (flag on + slug claim resolves to an active Service tenant) vs the legacy tenant_members fallback.';

-- ── get_user_tenant_ids() — claims-aware (by slug), tenant_members fallback ───
create or replace function public.get_user_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._identity_use_claims() then
      array[public._claim_service_tenant_id()]
    else
      -- legacy (pre-0131) behaviour, verbatim
      coalesce(
        (select array_agg(tenant_id)
           from public.tenant_members
          where user_id = auth.uid() and is_active = true),
        '{}'::uuid[])
  end;
$$;

-- ── get_user_role(p_tenant_id) — claims-aware (by slug), tenant_members fallback
create or replace function public.get_user_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._identity_use_claims() then
      case
        when public._claim_service_tenant_id() = p_tenant_id
        -- TODO (review HIGH, Phase 2): cross-check eq_role against membership
        -- (LEAST(claimed, actual)) once uid reconciliation lands, so a forged
        -- claim cannot elevate. Until then this is gated behind claims_enabled.
        then nullif(current_setting('request.jwt.claims', true), '')::jsonb
               -> 'app_metadata' ->> 'eq_role'
      end
    else
      -- legacy (pre-0131) behaviour, verbatim
      (select role
         from public.tenant_members
        where user_id = auth.uid()
          and tenant_id = p_tenant_id
          and is_active = true
        limit 1)
  end;
$$;
