-- Advisor cleanup for the safe-provisioning migrations (0115-0117).
--
-- enforce_slug_immutability is a TRIGGER function — it never needs to be callable
-- as an RPC. Revoke EXECUTE so PostgREST doesn't expose it (the trigger still
-- fires under the table owner, unaffected by these grants).
revoke execute on function public.enforce_slug_immutability() from public, anon, authenticated;

-- Cover the new foreign keys (advisor: unindexed_foreign_keys).
create index if not exists access_requests_resolved_by_idx on public.access_requests(resolved_by);
create index if not exists tenant_slug_tombstones_tenant_id_idx on public.tenant_slug_tombstones(tenant_id);
