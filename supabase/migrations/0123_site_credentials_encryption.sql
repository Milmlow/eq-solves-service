-- ============================================================
-- Migration 0123: Column-level encryption for site_credentials
--
-- Implements: S3-6 — encrypt password_value and username at rest
-- using pgcrypto symmetric encryption. The encryption key is held
-- in SITE_CREDENTIALS_KEY (Netlify env var) and passed at query time
-- via SECURITY DEFINER RPCs so the plaintext never persists in Postgres.

-- Create app_data schema if not present (exists on remote but was never
-- created via a migration — this makes fresh local Supabase apply correctly).
CREATE SCHEMA IF NOT EXISTS app_data;

-- Move site_credentials from public to app_data if it hasn't been moved yet.
-- On remote the table was relocated out-of-band; on a fresh local it starts in
-- public (created by migration 0078). The SET SCHEMA carries all indexes,
-- triggers, and RLS policies with it — no other tables hold FKs pointing at
-- this table, so the move is safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_credentials'
  ) THEN
    ALTER TABLE public.site_credentials SET SCHEMA app_data;
  END IF;
END $$;

--
-- NOTE (2026-06-09 fix): site_credentials lives in app_data schema,
-- not public. Functions stay in public schema so the Supabase JS
-- client can call them via .rpc() without schema qualification.
-- Role checking removed (no get_user_role() in this DB — role auth
-- is handled at the Next.js application layer, consistent with all
-- other app_data table policies which use tenant-only isolation).
--
-- Approach (Netlify env var pattern):
--   - pgp_sym_encrypt / pgp_sym_decrypt (pgcrypto) with a
--     caller-supplied key string. The key is NOT stored in Postgres.
--   - password_value and username are replaced with encrypted bytea
--     columns (password_enc, username_enc).
--   - Existing plaintext rows are migrated by scripts/rekey-site-credentials.ts
--     which uses the service role key + SITE_CREDENTIALS_KEY env var.
--   - A SECURITY DEFINER RPC decrypt_site_credential() decrypts a
--     single row for the calling tenant user.
--   - A SECURITY DEFINER RPC upsert_site_credential() encrypts on
--     INSERT/UPDATE for tenant users.
--   - A service-only _admin_rekey_site_credential() is used by the
--     rekey script — no JWT check, callable by service_role only.
--
-- Rollback notes:
--   - password_value_plain and username_plain are preserved as
--     nullable columns until the rekey script confirms zero-plaintext
--     rows, at which point migration 0124 drops them.
-- ============================================================

-- 1. Enable pgcrypto (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add encrypted columns
ALTER TABLE app_data.site_credentials
  ADD COLUMN IF NOT EXISTS password_enc  bytea,
  ADD COLUMN IF NOT EXISTS username_enc  bytea;

-- 3. Rename old plaintext columns to _plain variants (safety net)
DO $$
BEGIN
  -- password_value → password_value_plain
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data'
      AND table_name   = 'site_credentials'
      AND column_name  = 'password_value'
  ) THEN
    ALTER TABLE app_data.site_credentials
      RENAME COLUMN password_value TO password_value_plain;
  END IF;

  -- username → username_plain
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app_data'
      AND table_name   = 'site_credentials'
      AND column_name  = 'username'
  ) THEN
    ALTER TABLE app_data.site_credentials
      RENAME COLUMN username TO username_plain;
  END IF;
END $$;

-- 4. SECURITY DEFINER decrypt helper (public schema for JS RPC access)
--    Verifies the caller's JWT tenant matches the credential's tenant,
--    then returns decrypted username + password.
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
  v_tenant_id  uuid;
  v_jwt_tenant uuid;
BEGIN
  v_jwt_tenant := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  SELECT sc.tenant_id INTO v_tenant_id
  FROM app_data.site_credentials sc
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
  FROM app_data.site_credentials sc
  WHERE sc.id = p_credential_id
    AND sc.tenant_id = v_tenant_id
    AND sc.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.decrypt_site_credential(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrypt_site_credential(uuid, text)
  TO authenticated;

-- 5. SECURITY DEFINER upsert helper (public schema for JS RPC access)
--    Verifies JWT tenant, then encrypts username+password before persisting.
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
  v_jwt_tenant uuid;
  v_id         uuid;
BEGIN
  v_jwt_tenant := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF v_jwt_tenant IS NULL OR v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'tenant mismatch' USING errcode = 'EQ010';
  END IF;

  IF p_id IS NULL THEN
    -- INSERT
    INSERT INTO app_data.site_credentials (
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
    UPDATE app_data.site_credentials SET
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

-- 6. Service-only rekey helper — used by scripts/rekey-site-credentials.ts
--    No JWT check: service_role key bypasses all permission checks.
--    Reads existing plaintext from _plain columns, encrypts in-place,
--    then clears the _plain columns.
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
  UPDATE app_data.site_credentials
  SET
    username_enc         = CASE
      WHEN username_plain IS NOT NULL AND username_plain <> ''
      THEN pgp_sym_encrypt(username_plain, p_key)
      ELSE username_enc
    END,
    password_enc         = CASE
      WHEN password_value_plain IS NOT NULL AND password_value_plain <> ''
      THEN pgp_sym_encrypt(password_value_plain, p_key)
      ELSE password_enc
    END,
    username_plain       = NULL,
    password_value_plain = NULL
  WHERE id = p_id
    AND (password_value_plain IS NOT NULL OR username_plain IS NOT NULL);
END;
$$;

-- Intentionally NOT granted to authenticated — service_role only.
REVOKE ALL ON FUNCTION public._admin_rekey_site_credential(uuid, text) FROM PUBLIC;

-- 7. Update comments
COMMENT ON COLUMN app_data.site_credentials.password_enc IS
  'pgp_sym_encrypt(password, SITE_CREDENTIALS_KEY). Key held in Netlify env only.';
COMMENT ON COLUMN app_data.site_credentials.username_enc IS
  'pgp_sym_encrypt(username, SITE_CREDENTIALS_KEY). Key held in Netlify env only.';
COMMENT ON COLUMN app_data.site_credentials.password_value_plain IS
  'Legacy plaintext — preserved until rekey-site-credentials.ts confirms all rows encrypted. Drop in migration 0124.';
COMMENT ON COLUMN app_data.site_credentials.username_plain IS
  'Legacy plaintext — preserved until rekey-site-credentials.ts confirms all rows encrypted. Drop in migration 0124.';

COMMENT ON FUNCTION public.decrypt_site_credential IS
  'SECURITY DEFINER: decrypts a single site_credential row for the caller session. Tenant-gated via JWT app_metadata. Key is NOT stored in Postgres.';
COMMENT ON FUNCTION public.upsert_site_credential IS
  'SECURITY DEFINER: encrypts username+password before persisting. Tenant-gated via JWT app_metadata. Key supplied by caller.';
COMMENT ON FUNCTION public._admin_rekey_site_credential IS
  'Service-role only: migrates existing plaintext rows to encrypted. Used by scripts/rekey-site-credentials.ts. Not callable by authenticated users.';
