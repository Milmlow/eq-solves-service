-- 0132_current_service_uid.sql
--
-- Phase 2 — Service identity convergence: uid-reconciliation FOUNDATION.
--   Design : docs/identity-convergence-service-adoption.md
--   Sprint : docs/sprint-identity-convergence.md
--
-- ADDITIVE + INERT. Defines public._current_service_uid() but NO policy uses it
-- yet, so applying this migration changes nothing. A later, separately-reviewed
-- migration will switch the ~7 "own-record" RLS policies (notifications,
-- profiles, mfa_recovery_codes, access_requests) from auth.uid() to this helper.
--
-- THE PROBLEM IT SOLVES
-- A federated (Shell) session arrives with auth.uid() = the CANONICAL user id
-- (e.g. royce 85e30693), which is a stranger to Service's own auth.users (royce
-- 48fdc7ff). So "own-record" policies keyed on `user_id = auth.uid()` would
-- match nothing for Shell users. We can't re-key the data to canonical ids
-- without breaking DIRECT login (auth.uid() = Service id there).
--
-- THE FIX
-- Map the session back to the Service uid via the EMAIL claim. Verified live:
-- emails are unique in auth.users (deterministic), and the SKS email resolves to
-- the active Service account. Direct-login sessions return auth.uid() unchanged.
-- So the helper is correct for BOTH session types and needs no data re-key and
-- no cross-project mapping table.
--
-- SAFE BY DEFAULT: gated by _identity_use_claims() (migration 0131), which is
-- false until the rollout flag is on. Flag off → returns auth.uid() verbatim.

create or replace function public._current_service_uid()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._identity_use_claims() then
      -- federated session: map the email claim -> Service auth.users.id
      (select u.id
         from auth.users u
        where lower(u.email) = lower(nullif(
          nullif(current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'email', ''))
        limit 1)
    else
      -- direct-login session (and flag-off): unchanged
      auth.uid()
  end;
$$;

comment on function public._current_service_uid() is
  'Phase 2 convergence: the Service-namespace user id for the current session. Federated (claims-mode) sessions map the email claim -> Service auth.users.id (emails are unique); direct/flag-off sessions return auth.uid(). For "own-record" RLS once those policies migrate off auth.uid(). Inert until then.';
