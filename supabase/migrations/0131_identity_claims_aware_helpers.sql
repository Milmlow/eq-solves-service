-- 0131_identity_claims_aware_helpers.sql
--
-- Phase 1 — Service identity convergence.
--   Design : docs/identity-convergence-service-adoption.md
--   Sprint : docs/sprint-identity-convergence.md
--
-- Teaches the two RLS helper functions to resolve identity from the federated
-- JWT claims (app_metadata.tenant_id / eq_role) — the way EQ Field already does —
-- instead of Service's own tenant_members table. 120 of 167 RLS policies route
-- through these two functions, so re-pointing them converges the bulk of RLS
-- with ZERO policy edits.
--
-- SAFE BY DEFAULT. Behaviour is gated by public.identity_rollout.claims_enabled,
-- seeded FALSE. Applying this migration is a behavioural NO-OP: the helpers keep
-- using tenant_members verbatim (the `else` branch below is byte-for-byte the
-- pre-migration logic) until someone flips the flag. Post-flip rollback is a
-- single UPDATE (instant), not a migration.
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

-- ── Are we resolving identity from claims this session? ───────────────────────
-- TRUE only when (a) the flag is on AND (b) the request carries a federated JWT
-- with app_metadata.tenant_id. Direct-login / service-role sessions without that
-- claim always fall through to tenant_members, so the cutover is gradual and
-- legacy sessions are never starved of identity.
create or replace function public._identity_use_claims()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select claims_enabled from public.identity_rollout where id), false)
    and (
      nullif(current_setting('request.jwt.claims', true), '')::jsonb
        -> 'app_metadata' ->> 'tenant_id'
    ) is not null;
$$;

comment on function public._identity_use_claims() is
  'Phase 1 convergence: whether to resolve tenant/role from JWT app_metadata claims (flag on + claim present) vs the legacy tenant_members fallback.';

-- ── get_user_tenant_ids() — claims-aware, tenant_members fallback ─────────────
create or replace function public.get_user_tenant_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._identity_use_claims() then
      array[(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb
          -> 'app_metadata' ->> 'tenant_id'
      )::uuid]
    else
      -- legacy (pre-0131) behaviour, verbatim
      coalesce(
        (select array_agg(tenant_id)
           from public.tenant_members
          where user_id = auth.uid() and is_active = true),
        '{}'::uuid[])
  end;
$$;

-- ── get_user_role(p_tenant_id) — claims-aware, tenant_members fallback ────────
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
        when (
          nullif(current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'tenant_id'
        )::uuid = p_tenant_id
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
