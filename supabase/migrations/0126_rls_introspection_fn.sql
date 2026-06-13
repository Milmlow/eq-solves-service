-- 0126_rls_introspection_fn
--
-- Read-only introspection helper for RLS verification. Returns the RLS
-- posture of the public schema as JSON: every table's RLS-enabled flag and
-- whether it carries a tenant_id column, plus every policy's roles, command,
-- and USING / WITH CHECK expressions.
--
-- WHY THIS EXISTS
-- ───────────────
-- PostgREST only exposes the `public` schema, so neither the integration
-- tests nor scripts/audit-rls.ts can read pg_catalog / pg_policies directly.
-- This function is the single read-only window onto that metadata. It powers:
--   • tests/integration/rls/all-tables-coverage.test.ts  (auto-discovery)
--   • tests/integration/rls/cross-tenant-sweep.test.ts   (table list)
--   • scripts/audit-rls.ts                                (CI + live check)
--
-- SECURITY
-- ────────
-- SECURITY DEFINER so it can read catalog rows the caller might not own, but
-- EXECUTE is granted to service_role ONLY (revoked from PUBLIC, which is what
-- `authenticated` and `anon` inherit). It is therefore NOT callable by any
-- signed-in browser session and will NOT appear in the Supabase
-- `authenticated_security_definer_function_executable` advisor (that linter
-- only flags functions the `authenticated` role can reach). The function is
-- strictly read-only — it performs no writes and only SELECTs from pg_catalog.
-- search_path is pinned to '' so every catalog reference is schema-qualified
-- and the function cannot be hijacked by a mutable search_path.

create or replace function public.rls_introspection()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'tables', (
      select coalesce(
        json_agg(
          json_build_object(
            'table_name',   c.relname,
            'rls_enabled',  c.relrowsecurity,
            'has_tenant_id', exists (
              select 1
              from pg_catalog.pg_attribute a
              where a.attrelid = c.oid
                and a.attname  = 'tenant_id'
                and not a.attisdropped
            )
          )
          order by c.relname
        ),
        '[]'::json
      )
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
    ),
    'policies', (
      select coalesce(
        json_agg(
          json_build_object(
            'table_name', p.tablename,
            'policy',     p.policyname,
            'cmd',        p.cmd,
            'roles',      p.roles,
            'qual',       p.qual,
            'with_check', p.with_check
          )
          order by p.tablename, p.policyname
        ),
        '[]'::json
      )
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
    )
  );
$$;

-- Lock down execution: revoke the implicit PUBLIC grant, hand it only to the
-- server-side service role. anon / authenticated cannot call this.
revoke all on function public.rls_introspection() from public;
grant execute on function public.rls_introspection() to service_role;

comment on function public.rls_introspection() is
  'Read-only RLS posture of the public schema as JSON (tables + policies). service_role only. Powers RLS integration tests and scripts/audit-rls.ts.';
