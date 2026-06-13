# RLS verification — tenant isolation

How we prove that a user in one tenant can never read or write another tenant's
data. This is the single most load-bearing security guarantee in EQ Service:
RLS is enforced by Postgres *below* the application, so it survives any bug in
`requireUser()`, role checks, or server-action logic.

## Two tenant data planes (read this first)

"Everything routes to the tenant Supabase" is true — but there are **two**
tenant Supabases, chosen by auth path:

| Auth path | Supabase project | Client | Notes |
|---|---|---|---|
| EQ-entity user (standard Supabase session) | **`urjhmkhbgaxrofurpbgc`** (eq-service) | `createClient()` | The default. RLS uses `get_user_tenant_ids()` + `tenant_members`. |
| SKS user via Shell SSO (`eq_service_jwt` cookie) | **`ehowgjardagevnrluult`** (sks-canonical) | `createJwtClient()` | ehow has no `tenant_members`; SKS data lives in canonical `app_data.*`. RLS reads `auth.jwt() -> app_metadata -> tenant_id`. |

The tests and audit script in this repo verify the **EQ-entity plane**
(`urjhmkhbgaxrofurpbgc`). The **SKS / Shell plane** is enforced by canonical's
own RLS (project `ehowgjardagevnrluult`, guarded separately — see the
2026-06-07 canonical RLS spine work). When reasoning about SKS go-live
isolation, remember the guard lives in the canonical repo, not here.

## Three layers of verification

1. **Hand-written depth tests** — `tests/integration/rls/*-isolation.test.ts`
   (customers, maintenance_checks, audit_logs) and role-gating tests. These
   exercise all four attack shapes (read-by-id, list, insert-inject,
   update-target) on the highest-value tables.

2. **Auto-discovered structural net** — `all-tables-coverage.test.ts`. Reads the
   whole-schema RLS posture via `rls_introspection()` and asserts, for **every**
   table (including ones future migrations add):
   - RLS enabled everywhere
   - no tenant-scoped table has a permissive `USING (true)` / `WITH CHECK (true)`
   - every tenant table has a policy (or is documented service-role-only)
   - only documented public tables carry a permissive `true` policy

3. **Auto-discovered enforcement sweep** — `cross-tenant-sweep.test.ts`. Seeds
   Tenant A across the core FK chain, then proves Tenant B and anon see **zero**
   of it across every tenant-scoped table.

`rls_introspection()` (migration 0126) is a read-only, `service_role`-only
SECURITY DEFINER function — the one window onto `pg_catalog`/`pg_policies` that
PostgREST can reach. It is not callable by any browser session.

## Running the checks

```bash
# Local — full enforcement suite against `supabase start` (Docker required)
npm run test:integration

# Static gate — runs in CI; also the LIVE read-only check (see below)
npm run audit:rls
```

### Live read-only check (before go-live, or after any migration)

`audit:rls` mutates nothing — it only calls the read-only introspection RPC. To
verify the **live tenant project** directly, point env at it and run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://urjhmkhbgaxrofurpbgc.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<tenant service role key> \
npm run audit:rls
```

The script prints the project ref it targeted (`urjhmkhbgaxrofurpbgc`) so you
can confirm it hit the tenant Supabase. **Prerequisite:** migration 0126 must
be applied to the target project, or the RPC call fails with a clear message.
Alternatively, run the Supabase **security advisor** (`get_advisors`) — zero
ERROR-level findings is the bar.

## Documented allow-lists (keep test + script in sync)

Edit both `tests/integration/rls/all-tables-coverage.test.ts` and
`scripts/audit-rls.ts` when these change:

- **`SERVICE_ROLE_ONLY`** (RLS on, zero policies, deny-all to tenants):
  `canonical_outbox`, `context_proposals`, `tenant_slug_tombstones`.
- **`PUBLIC_TRUE_ALLOWED`** (intentional public surfaces with `USING (true)`):
  `briefs`, `estimates`, `estimate_events` (public intake), `_meta`
  (read-only attribution metadata).

A permissive `true` policy scoped to **service_role only** is auto-allowed
(service_role bypasses RLS regardless; the policy is unreachable by
anon/authenticated) — it never needs a waiver. `context_files` relies on this
after migration 0128.

> **Resolved 2026-06-13:** `context_files` previously had an anon `"Public read"`
> policy that made ~141 internal dev/architecture notes world-readable via the
> anon key. Migration 0128 dropped it — the table is now service-role-only.
> `_meta` remains anon-readable by design (a single ownership/attribution row,
> no tenant data).

## Last verified

- **2026-06-13** — live `urjhmkhbgaxrofurpbgc`: 43 tenant-scoped tables, all RLS
  on, all with ≥1 policy, **zero** permissive `true` policies. No ERROR-level
  security advisors. Posture is clean.
