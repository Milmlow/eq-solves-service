-- check_comments: threaded notes on a maintenance check.
-- Any tenant member can read. Non-read_only members can post (enforced app-layer).
-- Authors can delete their own comments.

create table public.check_comments (
  id          uuid        primary key default gen_random_uuid(),
  check_id    uuid        not null references public.maintenance_checks(id) on delete cascade,
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  created_by  uuid        not null references auth.users(id),
  body        text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint check_comments_body_length check (char_length(body) between 1 and 2000)
);

create index check_comments_check_id_idx   on public.check_comments(check_id);
create index check_comments_tenant_id_idx  on public.check_comments(tenant_id);
create index check_comments_created_by_idx on public.check_comments(created_by);

create trigger set_updated_at_check_comments
  before update on public.check_comments
  for each row execute function public.set_updated_at();

alter table public.check_comments enable row level security;

create policy "tenant members can read check comments"
  on public.check_comments for select
  using (tenant_id = ANY(public.get_user_tenant_ids()));

create policy "tenant members can insert check comments"
  on public.check_comments for insert
  with check (
    tenant_id = ANY(public.get_user_tenant_ids())
    and created_by = (select auth.uid())
  );

-- Authors can delete only their own comments.
create policy "comment authors can delete own comments"
  on public.check_comments for delete
  using (
    created_by = (select auth.uid())
    and tenant_id = ANY(public.get_user_tenant_ids())
  );
