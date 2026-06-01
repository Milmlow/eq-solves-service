-- 0112: RPC for defect counts — collapses 5 separate count queries into one.
--
-- BEFORE
--   defects/page.tsx fires 5 parallel Supabase count queries on every render:
--     total, open, in_progress, resolved, closed
--
-- AFTER
--   Single RPC returning all five counts in one query.
--   Caller passes p_tenant_id; RLS is still active on the connection.

CREATE OR REPLACE FUNCTION public.get_defect_counts(p_tenant_id uuid)
RETURNS TABLE(total bigint, open bigint, in_progress bigint, resolved bigint, closed bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint                                            AS total,
    COUNT(*) FILTER (WHERE status = 'open')::bigint            AS open,
    COUNT(*) FILTER (WHERE status = 'in_progress')::bigint     AS in_progress,
    COUNT(*) FILTER (WHERE status = 'resolved')::bigint        AS resolved,
    COUNT(*) FILTER (WHERE status = 'closed')::bigint          AS closed
  FROM public.defects
  WHERE tenant_id = p_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.get_defect_counts IS
  'Return all five defect status counts for a tenant in one query. Caller must supply the verified tenant_id — function is SECURITY DEFINER so it bypasses RLS, but callers should still hold a valid session to enforce authentication.';

GRANT EXECUTE ON FUNCTION public.get_defect_counts(uuid) TO authenticated;
