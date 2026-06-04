# Hand-off — add tenant slug to `eq_shell_session` (eq-shell repo)

**Status:** spec, awaiting Royce approval · **Repo:** `eq-shell` (NOT this repo)
**Blast radius:** auth — chat heads-up + explicit approval before deploy (AGENTS.md)
**This is the final activation switch** for slug-based SSO provisioning in Service.

## Why

Service maps Shell tenants to its own tenants by **slug** (the id spaces collide,
so id-mapping is unsafe — see tenant-registry-reconciliation.md). The session
cookie carries `tenant_id` + `memberships:[{tenant_id, role}]` but **no slug**, so
Service's provisioning is a no-op. Adding slug activates it.

## The change (eq-shell)

In `netlify/functions/_shared/token.ts`:

1. **`SessionMembership`** — add `slug`:
   ```ts
   export interface SessionMembership {
     tenant_id: string
     role: EqRole
     slug: string        // canonical tenants.slug — the cross-app join key
   }
   ```
2. **`SessionPayload`** — add the active tenant's slug:
   ```ts
   tenant_slug: string   // slug of active_tenant_id; mirrors existing tenant_id
   ```
3. **Populate both** from canonical `tenants.slug` wherever the session payload is
   built (`shell-login.ts` and any session re-issue path). Source of truth is the
   canonical `tenants` row already being read to build `memberships`.
4. **Keep HMAC signing unchanged.** This is additive to the signed JSON; the
   `EQ_SECRET_SALT` HMAC covers it automatically. Bump any payload version marker
   if one exists.

## Compatibility (safe, additive)

- Old cookies (no slug) → Service treats memberships as slug-less → **no
  provisioning** (current behaviour). No regression.
- Shell rolls cookies on every login, so the slug appears for all users within one
  login cycle. No migration of existing cookies needed.
- Other consumers (Field, Quotes) ignore unknown fields — already slug/mapping
  based (audited 2026-06-04, no raw-`tenant_id` cross-use).

## Activation sequence (after this ships)

1. Shell deploys the slug-bearing cookie (this spec). Service provisioning stays
   inert because `tenant_settings.allow_sso_autoprovision` is still **false**.
2. Verify in a pilot: a Shell user for `sks`/`eq` carries the right slug; confirm
   the resolver picks the correct Service tenant (no demo/collision involvement).
3. Flip `allow_sso_autoprovision = true` for **`sks` and `eq` only** (never the
   demo/colliding tenants), after a short soak with provisioning observable-but-off.
4. Watch `audit_logs` for `action = 'tenant_member.auto_provisioned'`
   (`metadata.source = 'shell_sso'`) — every grant is traced + reversible.

## Guardrails already on the Service side (merged)

- Slug-only mapping; id never crosses the boundary.
- Per-tenant opt-in flag (default off).
- Role clamped to a non-admin allowlist (`manager`/admin never auto-granted).
- Non-clobbering; `is_platform_admin` ignored; every grant audit-logged.
