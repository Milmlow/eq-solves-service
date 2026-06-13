-- ============================================================
-- Migration 0123: Column-level encryption for site_credentials
--
-- Implements: S3-6 — encrypt password + username at rest using pgcrypto
-- symmetric encryption. The key is held in SITE_CREDENTIALS_KEY (Netlify env)
-- and passed at query time via SECURITY DEFINER RPCs so the plaintext key
-- never persists in Postgres.
--
-- DESIGN NOTE (2026-06-13 rework): an earlier draft of this migration moved
-- site_credentials into an `app_data` schema. That broke the table-read path:
-- the GET /api/site-credentials list route uses `supabase.from('site_credentials')`,
-- which PostgREST resolves in `public`, and app_data is not exposed to PostgREST
-- (prod exposes only public + graphql_public; app_data did not even exist).
-- Verified on prod: site_credentials is empty (0 rows) and lives in public.
-- So we encrypt IN PLACE in public — no schema move, the list route keeps
-- working, the RPCs work, and there is no PostgREST-exposure change. The rest of
-- eq-service is entirely public-schema, so this is also the consistent choice.
--
-- Approach:
--   - pgcrypto pgp_sym_encrypt / pgp_sym_decrypt with a caller-supplied key.
--   - password/username are stored as encrypted bytea (password_enc, username_enc).
--   - Legacy plaintext columns are renamed to *_plain (safety net) and cleared
--     on every new write; scripts/rekey-site-credentials.ts encrypts any
--     pre-existing plaintext (none on prod — 0 rows).
--   - decrypt_site_credential() / upsert_site_credential() are tenant-gated via
--     JWT app_metadata. _admin_rekey_site_credential() is service-role only.
-- ============================================================

-- 1. pgcrypto (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Encrypted columns
ALTER TABLE public.site_credentials
  ADD COLUMN IF NOT EXISTS password_enc bytea,
  ADD COLUMN IF NOT EXISTS username_enc bytea;

-- 3. Rename legacy plaintext columns to *_plain (guarded / idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='site_credentials' AND column_name='password_value'
  ) THEN
    ALTER TABLE public.site_credentials RENAME COLUMN password_value TO password_value_plain;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='site_credentials' AND column_name='username'
  ) THEN
    ALTER TABLE public.site_credentials RENAME COLUMN username TO username_plain;
  END IF;
END $$;

-- 4. SECURITY DEFINER decrypt helper — JWT tenant-gated, reads public.site_credentials
CREATE OR REPLACE FUNCTION public.decrypt_site_credential(
  p_credential_id uuid,
  p_key           text
)
RETURNS TABLE (
  id           uuid,
  system_name  text,
  url          text,
  notes        text,
  username_dec text,
  password_dec text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_jwt_tenant uuid;
BEGIN
  v_jwt_tenant := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT sc.tenant_id INTO v_tenant_id
  FROM public.site_credentials sc
  WHERE sc.id = p_credential_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'site_credential not found';
  END IF;

  IF v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'tenant mismatch' USING errcode = 'EQ010';
  END IF;

  RETURN QUERY
  SELECT
    sc.id,
    sc.system_name,
    sc.url,
    sc.notes,
    CASE WHEN sc.username_enc IS NOT NULL
         THEN pgp_sym_decrypt(sc.username_enc, p_key)
         ELSE sc.username_plain END AS username_dec,
    CASE WHEN sc.password_enc IS NOT NULL
         THEN pgp_sym_decrypt(sc.password_enc, p_key)
         ELSE sc.password_value_plain END AS password_dec
  FROM public.site_credentials sc
  WHERE sc.id = p_credential_id
    AND sc.tenant_id = v_tenant_id
    AND sc.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.decrypt_site_credential(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_site_credential(uuid, text) TO authenticated;

-- 5. SECURITY DEFINER upsert helper — encrypts before persisting, tenant-gated
CREATE OR REPLACE FUNCTION public.upsert_site_credential(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_site_id     uuid,
  p_system_name text,
  p_username    text,
  p_password    text,
  p_url         text,
  p_notes       text,
  p_key         text,
  p_id          uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_tenant uuid;
  v_id         uuid;
BEGIN
  v_jwt_tenant := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'tenant mismatch' USING errcode = 'EQ010';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.site_credentials (
      tenant_id, customer_id, site_id, system_name,
      username_plain, password_value_plain,
      username_enc,   password_enc,
      url, notes, created_by, updated_by
    ) VALUES (
      p_tenant_id, p_customer_id, p_site_id, p_system_name,
      NULL, NULL,
      pgp_sym_encrypt(COALESCE(p_username, ''), p_key),
      pgp_sym_encrypt(COALESCE(p_password, ''), p_key),
      p_url, p_notes, auth.uid(), auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
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

REVOKE ALL ON FUNCTION public.upsert_site_credential(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_site_credential(uuid,uuid,uuid,text,text,text,text,text,text,uuid) TO authenticated;

-- 6. Service-only rekey helper — encrypts pre-existing plaintext in place
CREATE OR REPLACE FUNCTION public._admin_rekey_site_credential(
  p_id  uuid,
  p_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.site_credentials
  SET
    username_enc = CASE
      WHEN username_plain IS NOT NULL AND username_plain <> ''
      THEN pgp_sym_encrypt(username_plain, p_key) ELSE username_enc END,
    password_enc = CASE
      WHEN password_value_plain IS NOT NULL AND password_value_plain <> ''
      THEN pgp_sym_encrypt(password_value_plain, p_key) ELSE password_enc END,
    username_plain       = NULL,
    password_value_plain = NULL
  WHERE id = p_id
    AND (password_value_plain IS NOT NULL OR username_plain IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public._admin_rekey_site_credential(uuid, text) FROM PUBLIC, anon, authenticated;

-- 7. Comments
COMMENT ON COLUMN public.site_credentials.password_enc IS
  'pgp_sym_encrypt(password, SITE_CREDENTIALS_KEY). Key held in Netlify env only.';
COMMENT ON COLUMN public.site_credentials.username_enc IS
  'pgp_sym_encrypt(username, SITE_CREDENTIALS_KEY). Key held in Netlify env only.';
COMMENT ON FUNCTION public.decrypt_site_credential IS
  'SECURITY DEFINER: decrypts one site_credential for the caller session. Tenant-gated via JWT app_metadata. Key not stored in Postgres.';
COMMENT ON FUNCTION public.upsert_site_credential IS
  'SECURITY DEFINER: encrypts username+password before persisting. Tenant-gated via JWT app_metadata.';
COMMENT ON FUNCTION public._admin_rekey_site_credential IS
  'Service-role only: encrypts pre-existing plaintext rows. Used by scripts/rekey-site-credentials.ts.';
