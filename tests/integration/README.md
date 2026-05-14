# Integration tests

These tests run against a **real local Supabase** instance. They seed two
tenants with admin users, then assert that RLS policies actually keep them
isolated. The unit tests in `tests/lib/**/*.test.ts` use mocks and run in
CI; these live in a separate suite because they need Docker + a database.

## What's tested today

| File | Type | What it asserts |
|---|---|---|
| [rls/customers-isolation.test.ts](rls/customers-isolation.test.ts) | RLS | User in Tenant A cannot read or write Tenant B's customers — by id, by list, or by injecting a foreign tenant_id on insert |

## What's planned (PR 3b)

From the test-harness scoping doc, in priority order:

- [ ] **B.** `completed_by` set to current user on `completeCheckAction`
- [ ] **C.** `requireUser()` returns deterministic tenant for multi-tenant user
- [ ] **D.** Role-based gate on `setRoleAction` (admin-only)
- [ ] **E.** `issueMaintenanceReportAction` idempotency via `mutationId`
- [ ] **F.** Technician cannot complete someone else's check
- [ ] **G.** `read_only` role rejected by `updateReportSettingsAction`
- [ ] **H.** Re-sent `inviteUserAction` doesn't duplicate auth users

## Running locally

You need Docker, Node 20+, and the `supabase` CLI.

```bash
# 1. Start a local Supabase (if you don't already have it running)
supabase start

# 2. Make sure .env.local has these three vars from `supabase status`:
#    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
#    SUPABASE_SERVICE_ROLE_KEY=eyJh...

# 3. Run integration tests
npm run test:integration
```

The setup file refuses to run against any URL that doesn't look local
(`127.0.0.1`, `localhost`, `host.docker.internal`, `supabase_kong`). This
is a hardcoded safety gate — integration tests mutate the DB, so they
must never point at production.

## Helpers — `helpers/db.ts`

- `seedTenantWithAdmin(suffix)` — creates a tenant + admin user + membership
  via the service_role client. Returns IDs and the user's password so tests
  can sign in.
- `signedInClient(email, password)` — signs in via the anon key and returns
  the authenticated client. `auth.uid()` in any subsequent PostgREST call
  resolves to this user. **This is what RLS tests must use** — service_role
  bypasses RLS and would make every test pass.
- `adminClient()` — service_role client. Use for seeding and cleanup only.
- `cleanupTenant(seed)` — deletes the auth user + tenant row. FK cascades
  handle the rest. Best-effort: failures are swallowed.

## Writing a new test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedTenantWithAdmin, signedInClient, cleanupTenant } from '../helpers/db'

describe('My feature — what is asserted', () => {
  let tenant: Awaited<ReturnType<typeof seedTenantWithAdmin>>

  beforeAll(async () => { tenant = await seedTenantWithAdmin('myfeat') })
  afterAll(async () => { if (tenant) await cleanupTenant(tenant) })

  it('does the thing', async () => {
    const client = await signedInClient(tenant.user.email, tenant.user.password)
    // ... your assertion via `client.from(...)` etc.
  })
})
```

Use **fresh UUIDs every run** (already done by the helpers — seed IDs are
randomly generated). Don't rely on hardcoded fixture data; a previous
test's cleanup may have failed and the same ID could collide.

## CI

Not wired into the GitHub Actions `check.yml` pipeline yet — the workflow
runs `tsc --noEmit` + `npm audit` but skips `npm test` entirely (including
the unit tests). PR 3c will add a `supabase start` step + `npm test` +
`npm run test:integration` to gate merges.

Until then: run `npm run test:integration` locally before pushing
RLS-touching changes.
