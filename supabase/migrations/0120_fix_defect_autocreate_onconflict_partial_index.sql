-- ============================================================
-- Migration 0120: Fix auto-defect triggers — ON CONFLICT must name the
-- partial-index predicate.
--
-- Bug (found 2026-06-06, pre-SKS-go-live): migrations 0061/0062 created
-- PARTIAL unique indexes on the four defect source back-pointers, e.g.
--   uq_defects_source_check_item ON defects(source_check_item_id)
--     WHERE source_check_item_id IS NOT NULL
-- but the trigger functions use a BARE conflict target:
--   ON CONFLICT (source_check_item_id) DO UPDATE ...
--
-- Postgres will not infer a *partial* unique index from a bare
-- `ON CONFLICT (col)` — the arbiter predicate must be restated. So every
-- auto-defect path raised:
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
-- the moment a row transitioned to fail. This crashed:
--   * marking a maintenance_check_item result = 'fail'
--   * an ACB / NSX reading is_pass = false
--   * a test_record reading pass = false
-- i.e. the core on-site failure workflow. It went unnoticed because no
-- real failure had flowed through prod yet (auto-defect tables were empty).
--
-- Fix: re-state each function with the partial-index predicate added to the
-- ON CONFLICT target. No data change, no index change — the partial indexes
-- are correct and deliberate (manual defects carry NULL source ids and must
-- not be indexed). Only the conflict target was under-specified.
--
-- Bodies below are reproduced verbatim from 0061/0062 with the single
-- `WHERE <col> IS NOT NULL` addition on each ON CONFLICT line.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. maintenance_check_items.result -> defects
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_item_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_check    record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.result = 'fail')
     OR (TG_OP = 'UPDATE' AND NEW.result = 'fail' AND COALESCE(OLD.result, '') <> 'fail')
  THEN
    SELECT mc.tenant_id, mc.site_id
      INTO v_check
      FROM public.maintenance_checks mc
     WHERE mc.id = NEW.check_id;

    v_severity := 'medium';
    v_title := 'Failed: ' || COALESCE(LEFT(NEW.description, 100), 'maintenance check item');

    INSERT INTO public.defects (
      tenant_id, check_id, check_asset_id, asset_id, site_id,
      title, description, severity, status, raised_by, source, source_check_item_id
    ) VALUES (
      v_check.tenant_id, NEW.check_id, NULL, NEW.asset_id, v_check.site_id,
      v_title, NEW.notes, v_severity, 'open', NEW.completed_by, 'auto_check_item', NEW.id
    )
    ON CONFLICT (source_check_item_id) WHERE source_check_item_id IS NOT NULL DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.result, '') = 'fail'
     AND COALESCE(NEW.result, '') <> 'fail'
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolved_by = NEW.completed_by,
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source check item re-marked as ' || COALESCE(NEW.result, 'NULL') || '.',
           updated_at = now()
     WHERE source_check_item_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. acb_test_readings.is_pass -> defects
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_acb_reading_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_test     record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_pass = false)
     OR (TG_OP = 'UPDATE' AND NEW.is_pass = false AND COALESCE(OLD.is_pass, true) <> false)
  THEN
    SELECT t.tenant_id, t.asset_id, t.site_id
      INTO v_test
      FROM public.acb_tests t
     WHERE t.id = NEW.acb_test_id;

    v_severity := public.fn_severity_from_reading_label(NEW.label);
    v_title := 'ACB failed: ' || COALESCE(LEFT(NEW.label, 100), 'reading');

    INSERT INTO public.defects (
      tenant_id, asset_id, site_id, title, description, severity, status,
      source, source_acb_reading_id
    ) VALUES (
      v_test.tenant_id, v_test.asset_id, v_test.site_id, v_title,
      'Reading "' || NEW.label || '" = ' || COALESCE(NEW.value, '?') || ' ' || COALESCE(NEW.unit, '') || ' (failed)',
      v_severity, 'open', 'auto_acb_test', NEW.id
    )
    ON CONFLICT (source_acb_reading_id) WHERE source_acb_reading_id IS NOT NULL DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_pass, true) = false
     AND COALESCE(NEW.is_pass, true) <> false
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source ACB reading flipped to pass.',
           updated_at = now()
     WHERE source_acb_reading_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. nsx_test_readings.is_pass -> defects
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_nsx_reading_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_test     record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_pass = false)
     OR (TG_OP = 'UPDATE' AND NEW.is_pass = false AND COALESCE(OLD.is_pass, true) <> false)
  THEN
    SELECT t.tenant_id, t.asset_id, t.site_id
      INTO v_test
      FROM public.nsx_tests t
     WHERE t.id = NEW.nsx_test_id;

    v_severity := public.fn_severity_from_reading_label(NEW.label);
    v_title := 'NSX failed: ' || COALESCE(LEFT(NEW.label, 100), 'reading');

    INSERT INTO public.defects (
      tenant_id, asset_id, site_id, title, description, severity, status,
      source, source_nsx_reading_id
    ) VALUES (
      v_test.tenant_id, v_test.asset_id, v_test.site_id, v_title,
      'Reading "' || NEW.label || '" = ' || COALESCE(NEW.value, '?') || ' ' || COALESCE(NEW.unit, '') || ' (failed)',
      v_severity, 'open', 'auto_nsx_test', NEW.id
    )
    ON CONFLICT (source_nsx_reading_id) WHERE source_nsx_reading_id IS NOT NULL DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_pass, true) = false
     AND COALESCE(NEW.is_pass, true) <> false
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source NSX reading flipped to pass.',
           updated_at = now()
     WHERE source_nsx_reading_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. test_record_readings.pass -> defects
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_test_record_reading_to_defect()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_test     record;
  v_severity text;
  v_title    text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.pass = false)
     OR (TG_OP = 'UPDATE' AND NEW.pass = false AND COALESCE(OLD.pass, true) <> false)
  THEN
    SELECT t.tenant_id, t.asset_id, t.site_id
      INTO v_test
      FROM public.test_records t
     WHERE t.id = NEW.test_record_id;

    v_severity := public.fn_severity_from_reading_label(NEW.label);
    v_title := 'Test failed: ' || COALESCE(LEFT(NEW.label, 100), 'reading');

    INSERT INTO public.defects (
      tenant_id, asset_id, site_id, title, description, severity, status,
      source, source_test_record_reading_id
    ) VALUES (
      v_test.tenant_id, v_test.asset_id, v_test.site_id, v_title,
      'Reading "' || NEW.label || '" = ' || COALESCE(NEW.value, '?') || ' ' || COALESCE(NEW.unit, '') || ' (failed)',
      v_severity, 'open', 'auto_general_test', NEW.id
    )
    ON CONFLICT (source_test_record_reading_id) WHERE source_test_record_reading_id IS NOT NULL DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      status = CASE
                 WHEN public.defects.status IN ('resolved', 'closed') THEN 'open'
                 ELSE public.defects.status
               END,
      updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.pass, true) = false
     AND COALESCE(NEW.pass, true) <> false
  THEN
    UPDATE public.defects
       SET status = 'resolved',
           resolved_at = now(),
           resolution_notes = COALESCE(resolution_notes, '') ||
             CASE WHEN COALESCE(resolution_notes, '') = '' THEN '' ELSE E'\n' END ||
             'Auto-resolved: source test reading flipped to pass.',
           updated_at = now()
     WHERE source_test_record_reading_id = NEW.id
       AND status NOT IN ('resolved', 'closed');
  END IF;

  RETURN NEW;
END;
$$;
