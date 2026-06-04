-- Per-tenant opt-in for Shell SSO auto-provisioning of tenant_members.
--
-- Default OFF: cross-app provisioning stays explicit/invite unless a tenant
-- deliberately opts in. The auto-routing model was reverted twice precisely
-- because it auto-granted membership from cross-app claims; this flag makes
-- any auto-grant a conscious, per-tenant, reversible decision.
--
-- Enable ONLY for tenants whose canonical<->Service slug mapping is verified
-- 1:1 (e.g. sks, eq) — NEVER the demo/colliding tenants. The provisioning
-- code additionally clamps the granted role to a non-admin allowlist and
-- writes an audit_logs row with source='shell_sso' for traceability.
--
-- See docs/proposals/tenant-registry-reconciliation.md (DECISIONS 2026-06-04).

alter table public.tenant_settings
  add column if not exists allow_sso_autoprovision boolean not null default false;

comment on column public.tenant_settings.allow_sso_autoprovision is
  'When true, a Shell-authenticated user carrying a verified (slug-matched) membership for this tenant is auto-added to tenant_members on SSO, with role clamped to a non-admin allowlist and the grant audit-logged. Default false = explicit/invite only. Enable only for verified-1:1 tenants, never demo/colliding ones.';
