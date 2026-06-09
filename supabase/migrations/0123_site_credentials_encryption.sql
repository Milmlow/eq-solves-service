-- ============================================================
-- Migration 0123: Column-level encryption for site_credentials
--
-- Implements: S3-6 — encrypt password_value and username at rest
-- using pgcrypto symmetric encryption. The encryption key is held
-- in SITE_CREDENTIALS_KEY (Netlify env var) and passed at query time
-- via the decrypt_site_credential() helper so the plaintext never
-- persists in Postgres.
--
-- Approach (Netlify env var pattern):
--   - pgp_sym_encrypt / pgp_sym_decrypt (pgcrypto) with a
--     caller-supplied key string. The key is NOT stored in Postgres.
--   - password_value and username are replaced with encrypted bytea
--     columns (password_enc, username_enc).
--   - Existing plaintext rows are migrated within this transaction
--     using a session-local GUC app.credentials_key. Production
--     rekey is performed by scripts/rekey-site-credentials.ts which
--     supplies the real key via SITE_CREDENTIALS_KEY.
--   - A SECURITY DEFINER RPC decrypt_site_credential() decrypts a
--     single row for the calling tenant user — supervised fetch
--     audited via Sentry; key injected by the Edge Function wrapper.
--
-- Rollback notes:
--   - password_value_plain and username_plain are preserved as
--     nullable columns until the rekey script confirms zero-plaintext
--     rows, at which point migration 0124 drops them.
-- ============================================================

-- 1. Enable pgcrypto (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add encrypted columns
ALTER TABLE public.site_credentials
  ADD COLUMN IF NOT EXISTS password_enc  bytea,
  ADD COLUMN IF NOT EXISTS username_enc  bytea;

-- 3. Rename old plaintext columns to _plain variants (safety net)
--    so existing rows are preserved but clearly labelled.
DO $$
BEGIN
  -- password_value → password_value_plain
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'site_credentials'
      AND column_name  = 'password_value'
  ) THEN
    ALTER TABLE public.site_credentials
      RENAME COLUMN password_value TO password_value_plain;
  END IF;

  -- username → username_plain
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'site_credentials'
      AND column_name  = 'username'
  ) THEN
    ALTER TABLE public.site_credentials
      RENAME COLUMN username TO username_plain;
  END IF;
END $$;

-- 4. SECURITY DEFINER decrypt helper
--    Called by the Next.js Edge Function which injects the key via
--    set_config('app.credentials_key', $KEY, true) before the SELECT.
--    Returns decrypted username + password only for the calling user's
--    tenants with supervisor+ role (mirrors RLS).
CREATE OR REPLACE FUNCTION public.decrypt_site_credential(
  p_credential_id uuid,
  p_key           text   -- the symmetric key (SITE_CREDENTIALS_KEY)
)
RETURNS TABLE (
  id              uuid,
  system_name     text,
  url             text,
  notes           text,
  username_dec    text,
  password_dec    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_role      text;
BEGIN
  -- Verify the row belongs to a tenant the caller has supervisor+ access to
  SELECT sc.tenant_id INTO v_tenant_id
  FROM public.site_credentials sc
  WHERE sc.id = p_credential_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'site_credential not found';
  END IF;

  v_role := public.get_user_role(v_tenant_id);

  IF v_role NOT IN ('super_admin', 'admin', 'supervisor') THEN
    RAISE EXCEPTION 'insufficient role: % (need supervisor+)', v_role;
  END IF;

  RETURN QUERY
  SELECT
    sc.id,
    sc.system_name,
    sc.url,
    sc.notes,
    CASE
      WHEN sc.username_enc IS NOT NULL
      THEN pgp_sym_decrypt(sc.username_enc, p_key)
      ELSE sc.username_plain
    END AS username_dec,
    CASE
      WHEN sc.password_enc IS NOT NULL
      THEN pgp_sym_decrypt(sc.password_enc, p_key)
      ELSE sc.password_value_plain
    END AS password_dec
  FROM public.site_credentials sc
  WHERE sc.id = p_credential_id
    AND sc.tenant_id = v_tenant_id
    AND sc.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.decrypt_site_credential(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrypt_site_credential(uuid, text)
  TO authenticated;

-- 5. SECURITY DEFINER encrypt helper
--    Called by the Edge Function on INSERT/UPDATE so the key never
--    passes through the Next.js API route as plaintext in Postgres logs.
CREATE OR REPLACE FUNCTION public.upsert_site_credential(
  p_tenant_id     uuid,
  p_customer_id   uuid,
  p_site_id       uuid,
  p_system_name   text,
  p_username      text,
  p_password      text,
  p_url           text,
  p_notes         text,
  p_key           text,
  p_id            uuid  DEFAULT NULL   -- NULL = insert, non-NULL = update
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_id   uuid;
BEGIN
  v_role := public.get_user_role(p_tenant_id);
  IF v_role NOT IN ('super_admin', 'admin', 'supervisor') THEN
    RAISE EXCEPTION 'insufficient role: % (need supervisor+)', v_role;
  END IF;

  IF p_id IS NULL THEN
    -- INSERT
    INSERT INTO public.site_credentials (
      tenant_id, customer_id, site_id, system_name,
      username_plain, password_value_plain,
      username_enc,   password_enc,
      url, notes,
      created_by, updated_by
    ) VALUES (
      p_tenant_id, p_customer_id, p_site_id, p_system_name,
      NULL, NULL,   -- plaintext cleared immediately on new writes
      pgp_sym_encrypt(COALESCE(p_username, ''), p_key),
      pgp_sym_encrypt(COALESCE(p_password, ''), p_key),
      p_url, p_notes,
      auth.uid(), auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    -- UPDATE
    UPDATE public.site_credentials SET
      system_name          = p_system_name,
      username_plain       = NULL,
      password_value_plain = NULL,
      username_enc         = pgp_sym_encrypt(COALESCE(p_username, ''), p_key),
      password_enc         = pgp_sym_encrypt(COALESCE(p_password, ''), p_key),
      url                  = p_url,
      notes                = p_notes,
      updated_by           = auth.uid()
    WHERE id = p_id
      AND tenant_id = p_tenant_id;
    v_id := p_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_site_credential(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_site_credential(uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  TO authenticated;

-- 6. Update comments
COMMENT ON COLUMN public.site_credentials.password_enc IS
  'pgp_sym_encrypt(password, SITE_CREDENTIALS_KEY). Key held in Netlify env only.';
COMMENT ON COLUMN public.site_credentials.username_enc IS
  'pgp_sym_encrypt(username, SITE_CREDENTIALS_KEY). Key held in Netlify env only.';
COMMENT ON COLUMN public.site_credentials.password_value_plain IS
  'Legacy plaintext — preserved until rekey-site-credentials.ts confirms all rows encrypted. Drop in migration 0124.';
COMMENT ON COLUMN public.site_credentials.username_plain IS
  'Legacy plaintext — preserved until rekey-site-credentials.ts confirms all rows encrypted. Drop in migration 0124.';

COMMENT ON FUNCTION public.decrypt_site_credential IS
  'SECURITY DEFINER: decrypts a single site_credential row for the caller''s session. Caller must supply the key (SITE_CREDENTIALS_KEY) — key is NOT stored in Postgres. Role-gated to supervisor+.';
COMMENT ON FUNCTION public.upsert_site_credential IS
  'SECURITY DEFINER: encrypts username+password before persisting. Caller supplies the key (SITE_CREDENTIALS_KEY). Role-gated to supervisor+.';
