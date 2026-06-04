-- Access requests — replaces the dead "No tenant assigned" gate.
--
-- A Shell-authenticated user with no tenant_members row can record a PENDING
-- request (not a membership) instead of hitting a dead end. Admins action it
-- via the existing /admin/users orphan-attach flow (a service-role server
-- action gated by isAdmin), so this table needs NO admin RLS policy — RLS here
-- only ever exposes a user their OWN request. That keeps the table free of any
-- cross-tenant read surface (requests are not tenant-scoped).
--
-- See docs/proposals/tenant-registry-reconciliation.md (DECISIONS 2026-06-04).

create table if not exists public.access_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  email          text not null,
  requested_slug text,                 -- optional: the tenant slug the user believes they belong to
  note           text,
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'denied', 'cancelled')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references auth.users(id)
);

-- At most one OPEN (pending) request per user.
create unique index if not exists access_requests_user_pending
  on public.access_requests(user_id) where status = 'pending';

alter table public.access_requests enable row level security;

-- Own-rows only. Works for a tenant-less user (keyed on auth.uid(), not tenant).
-- auth.uid() wrapped in (select ...) so the planner evaluates it once (migration 0027 pattern).
create policy "access_requests: select own"
  on public.access_requests for select to authenticated
  using (user_id = (select auth.uid()));

create policy "access_requests: insert own"
  on public.access_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "access_requests: cancel own"
  on public.access_requests for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Admin review + resolve runs through the service-role server action (gated by
-- isAdmin at the app layer), which bypasses RLS — no admin policy is added here
-- so the table never exposes one user's request to another tenant's admins.
