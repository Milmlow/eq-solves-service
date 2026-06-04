-- Slug is the cross-app identity key (decisions 2026-06-04). Reconcile the one
-- drift and make slugs immutable + non-recyclable so the key is trustworthy.
--
-- Audit 2026-06-04: nothing in Service references the literal 'demo-electrical'
-- (code or data); Field/Quotes resolve by slug/mapping with safe fallbacks. So
-- renaming the Service demo tenant's slug is safe.
--
-- See docs/proposals/tenant-registry-reconciliation.md.

-- 1. Tombstone table: a retired slug can never be reused by another tenant. ---
create table if not exists public.tenant_slug_tombstones (
  slug       text primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  retired_at timestamptz not null default now()
);

-- RLS on, no client policy: this is a system reference table written only by the
-- SECURITY DEFINER trigger below (and the service role). Clients have no need to
-- read or write it, so the most locked-down posture is deny-all-to-clients.
alter table public.tenant_slug_tombstones enable row level security;

-- 2. Reconcile the demo slug BEFORE the lockout trigger exists. Tombstone the
--    old value, then rename. Idempotent — only acts if the old slug is present.
do $$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'demo-electrical';
  if v_tenant is not null then
    insert into public.tenant_slug_tombstones(slug, tenant_id)
      values ('demo-electrical', v_tenant)
      on conflict (slug) do nothing;
    update public.tenants set slug = 'demo-trades' where id = v_tenant;
  end if;
end $$;

-- 3. Immutability: block recycling a retired slug, and lock renames entirely.
--    A governed rename must temporarily disable this trigger inside a migration.
create or replace function public.enforce_slug_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.tenant_slug_tombstones t where t.slug = new.slug) then
    raise exception 'tenant slug "%" is retired and cannot be reused', new.slug
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    raise exception 'tenant slug is immutable (was "%", got "%") -- rename via a governed migration', old.slug, new.slug
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_slug_immutability on public.tenants;
create trigger trg_enforce_slug_immutability
  before insert or update of slug on public.tenants
  for each row execute function public.enforce_slug_immutability();
