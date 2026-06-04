# Runbook — SKS go-live tenant seed (bootstrap + pre-attach)

**Event:** SKS onboarding day — **2026-06-21** · **Owner:** Royce
**SKS tenant id:** `ccca00fc-cbc8-442e-9489-0f1f216ddca8` · **slug:** `sks`

## Why this exists

A user authenticated in Shell who opens Service with **no `tenant_members` row**
hits the access gate. They can now lodge a request (migration 0117), but on
go-live day you don't want techs waiting on a manual approval — and the **first
admin of a tenant can't self-provision** because `/admin/users` sits behind the
same gate (bootstrap deadlock). Auto-provisioning is **not** relied on for
go-live: it's off by default and needs the Shell cookie slug change first. The
go-live path is a **service-role pre-attach** done ahead of the day.

> Do **not** use `tenant_settings.default_tenant_for_new_users` as the front
> door — it's a single per-instance tenant and co-mingles users if misused.

## T-minus (before 2026-06-21)

### 1. Get the roster
Collect the email + intended role for every SKS user who needs Service. Roles are
canonical: `manager` (admin), `supervisor`, `employee` (tech).

### 2. Ensure each has an auth account
First Shell SSO auto-creates the `auth.users` + `profiles` row. To pre-create
ahead of time, use the platform tenant API or Supabase admin `createUser`. Users
who have already opened Service once already exist — check:

```sql
select id, email from auth.users
where lower(email) = any (array['tech1@sks...','tech2@sks...']);  -- the roster
```

### 3. Pre-attach to the SKS tenant (the seed)
Run as service role (SQL editor / MCP). Idempotent — re-runnable. Maps each
roster email to its `auth.users` id and upserts an active `tenant_members` row:

```sql
-- Edit the VALUES list: (email, canonical role)
with roster(email, role) as (
  values
    ('manager@sks.example',    'manager'),
    ('supervisor@sks.example', 'supervisor'),
    ('tech1@sks.example',      'employee')
)
insert into public.tenant_members (user_id, tenant_id, role, is_active)
select u.id, 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', r.role, true
from roster r
join auth.users u on lower(u.email) = lower(r.email)
on conflict (user_id, tenant_id) do update
  set role = excluded.role, is_active = true;
```

Roster emails with no `auth.users` match are skipped (silently) — chase those up
(they've never signed in) and re-run.

### 4. Verify
```sql
select tm.role, count(*)
from tenant_members tm
where tm.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8' and tm.is_active
group by tm.role order by 2 desc;

-- roster members NOT yet attached (exist in auth but no SKS membership):
select u.email from auth.users u
where lower(u.email) = any (array['...roster...'])
  and not exists (
    select 1 from tenant_members tm
    where tm.user_id = u.id
      and tm.tenant_id = 'ccca00fc-cbc8-442e-9489-0f1f216ddca8'
      and tm.is_active);
```

## On the day

- Watch PostHog for `mfa_redirect` spikes and any access-gate hits.
- For a straggler who hits the gate: have the **section 3 seed** ready — add their
  email to the roster VALUES and re-run (takes seconds). Or attach via
  `/admin/users` as an existing SKS admin (`repairUserTenantAction`).
- **Never** attach a tech to the demo tenant by mistake. After migration 0118 the
  demo slug is `demo-trades`; SKS is `sks`. Attach by the **SKS tenant id above**,
  not by guessing a slug.

## Rollback / correction

A wrong attach is a soft-delete, not a hard delete:
```sql
update tenant_members set is_active = false
where user_id = '<user>' and tenant_id = '<wrong tenant>';
```
Then re-run the seed with the correct tenant.

## Notes
- This is the **manual** go-live path. Automatic SSO provisioning
  (`allow_sso_autoprovision`, migration 0116) stays **off** for go-live and is a
  later, per-tenant, approval-gated step that also needs the Shell cookie slug.
- All seed writes are service-role; they bypass RLS by design. Keep the roster
  out of the repo (PII).
