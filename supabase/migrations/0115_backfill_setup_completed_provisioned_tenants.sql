-- migration: 0115_backfill_setup_completed_provisioned_tenants
-- Stop the first-run onboarding wizard from re-prompting tenants that were
-- provisioned with their identity already established from the EQ tenant
-- canonical (shell_control.tenants). For these tenants the company name and
-- branding are set at provisioning time, so there is nothing for the wizard to
-- collect that canonical doesn't already own.
--
-- The wizard gate in app/(app)/layout.tsx fires when ALL of an admin's tenants
-- have setup_completed_at IS NULL. For canonical-provisioned tenants that flag
-- was never set (no one ran the wizard end-to-end), so the modal shows even
-- though tenants.name is already populated and pre-filled into the form. The
-- genuinely-blank fields it asks for (ABN, address, phone, support email) have
-- no canonical source anyway — they live per-customer, not on the tenant — so
-- they belong on the non-blocking dashboard checklist / Settings, not a
-- blocking first-run modal.
--
-- Scope: eq (EQ Solutions) and sks (SKS Technologies) only — the two live
-- canonical-provisioned tenants. Self-serve / demo tenants are intentionally
-- left untouched so genuinely-empty workspaces still get the wizard.
--
-- Idempotent: guarded on setup_completed_at IS NULL so re-running never clobbers
-- a real completion timestamp.

UPDATE public.tenants
SET setup_completed_at = now()
WHERE slug IN ('eq', 'sks')
  AND setup_completed_at IS NULL;
