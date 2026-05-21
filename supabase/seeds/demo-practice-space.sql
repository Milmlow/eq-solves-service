-- supabase/seeds/demo-practice-space.sql
--
-- DEMO — Practice Space. A clearly-labelled sandbox customer + site +
-- assets + checks + defects that the SKS team can break safely during
-- the onboarding day (and ongoing training) without touching real
-- Equinix or Jemena records.
--
-- Everything is name-prefixed "DEMO —" so it's visually impossible to
-- mistake for production data. Stable UUIDs + ON CONFLICT DO NOTHING
-- so this seed is idempotent — re-running won't double up the records.
--
-- Tenant: ccca00fc-cbc8-442e-9489-0f1f216ddca8 (SKS)
--
-- To run:
--   supabase db push    (auto-applies seeds on a fresh project)
--   psql -f supabase/seeds/demo-practice-space.sql
--
-- To remove (between training sessions if you want a clean slate):
--   The seed is idempotent so re-running just re-creates anything
--   missing. If you want a hard reset, manually delete by
--   tenant_id='ccca00fc-cbc8-442e-9489-0f1f216ddca8' AND name LIKE 'DEMO —%'.
--
-- Built 2026-05-21 for the SKS onboarding-day prep.

BEGIN;

-- ── 1. Customer ──────────────────────────────────────────────────
INSERT INTO public.customers (
  id, tenant_id, name, code, email, phone, address, is_active
) VALUES (
  'de000001-0000-4000-8000-000000000001',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'DEMO — Practice Space',
  'DEMO',
  'practice@example.com',
  '0000 000 000',
  '1 Practice Lane, Demoville NSW 2000',
  true
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Site ──────────────────────────────────────────────────────
INSERT INTO public.sites (
  id, tenant_id, customer_id, name, code, address, city, state, postcode, country,
  latitude, longitude, is_active
) VALUES (
  'de000002-0000-4000-8000-000000000001',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'de000001-0000-4000-8000-000000000001',
  'DEMO — Building A Plant Room',
  'DEMO-A',
  '1 Practice Lane',
  'Demoville',
  'NSW',
  '2000',
  'AU',
  -33.8688, -- Sydney CBD ish — gives the "Open in Maps" link a real target
  151.2093,
  true
) ON CONFLICT (id) DO NOTHING;

-- ── 3. Assets ────────────────────────────────────────────────────
-- Eight varied asset types so techs see breakers, a switchboard, a
-- transformer, an ATS — the typical mix on a real visit.
INSERT INTO public.assets (
  id, tenant_id, site_id, name, asset_type, manufacturer, model, serial_number, location, is_active
) VALUES
  ('de000003-0000-4000-8000-000000000001', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — MSB-1 Main Switchboard', 'Switchboard', 'Schneider', 'Okken', 'DEMO-MSB-001', 'Plant Room — Wall A', true),
  ('de000003-0000-4000-8000-000000000002', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — ACB-1 Incoming Breaker', 'ACB', 'Schneider', 'NW20', 'DEMO-ACB-001', 'Plant Room — MSB-1 Cell 1', true),
  ('de000003-0000-4000-8000-000000000003', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — ACB-2 Tie Breaker', 'ACB', 'Schneider', 'NW16', 'DEMO-ACB-002', 'Plant Room — MSB-1 Cell 4', true),
  ('de000003-0000-4000-8000-000000000004', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — NSX-1 Distribution', 'NSX', 'Schneider', 'NSX250', 'DEMO-NSX-001', 'Plant Room — DB-1 Position 3', true),
  ('de000003-0000-4000-8000-000000000005', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — DB-1 Distribution Board', 'Distribution Board', 'Generic', 'DB-100', 'DEMO-DB-001', 'Plant Room — Wall B', true),
  ('de000003-0000-4000-8000-000000000006', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — TX-1 Dry Transformer', 'Transformer', 'ABB', 'EcoDry', 'DEMO-TX-001', 'Transformer Bay', true),
  ('de000003-0000-4000-8000-000000000007', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — ATS-1 Auto Transfer Switch', 'ATS', 'ASCO', '7000 Series', 'DEMO-ATS-001', 'Plant Room — Wall C', true),
  ('de000003-0000-4000-8000-000000000008', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000002-0000-4000-8000-000000000001',
   'DEMO — UPS-1 Single Use UPS', 'UPS', 'Eaton', '9PX', 'DEMO-UPS-001', 'UPS Room', true)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Maintenance checks ────────────────────────────────────────
-- Three checks in three states so techs see the full lifecycle.

-- 4a) Scheduled — a fresh quarterly PPM the tech can start from zero
INSERT INTO public.maintenance_checks (
  id, tenant_id, site_id, kind, status, frequency, due_date, start_date,
  custom_name, is_active
) VALUES (
  'de000004-0000-4000-8000-000000000001',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'de000002-0000-4000-8000-000000000001',
  'maintenance',
  'scheduled',
  'quarterly',
  CURRENT_DATE + INTERVAL '7 days',
  CURRENT_DATE,
  'DEMO — Quarterly Plant Inspection',
  true
) ON CONFLICT (id) DO NOTHING;

-- 4b) In-progress — half-done so the tech sees what "mid-job" looks like
INSERT INTO public.maintenance_checks (
  id, tenant_id, site_id, kind, status, frequency, due_date, start_date, started_at,
  custom_name, is_active
) VALUES (
  'de000004-0000-4000-8000-000000000002',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'de000002-0000-4000-8000-000000000001',
  'maintenance',
  'in_progress',
  'monthly',
  CURRENT_DATE,
  CURRENT_DATE - INTERVAL '1 day',
  NOW() - INTERVAL '2 hours',
  'DEMO — Monthly Switchboard Walk-through',
  true
) ON CONFLICT (id) DO NOTHING;

-- 4c) Complete — last week, signed off, so the tech sees a finished record
INSERT INTO public.maintenance_checks (
  id, tenant_id, site_id, kind, status, frequency, due_date, start_date, started_at, completed_at,
  custom_name, is_active
) VALUES (
  'de000004-0000-4000-8000-000000000003',
  'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
  'de000002-0000-4000-8000-000000000001',
  'maintenance',
  'complete',
  'annual',
  CURRENT_DATE - INTERVAL '7 days',
  CURRENT_DATE - INTERVAL '14 days',
  NOW() - INTERVAL '14 days',
  NOW() - INTERVAL '7 days',
  'DEMO — Annual Compliance Visit (last week)',
  true
) ON CONFLICT (id) DO NOTHING;

-- ── 5. Check assets — link each check to one or more demo assets ─

-- Scheduled check: covers all 8 assets
INSERT INTO public.check_assets (id, tenant_id, check_id, asset_id, status) VALUES
  ('de000006-0000-4000-8000-000000000101', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000003-0000-4000-8000-000000000001', 'pending'),
  ('de000006-0000-4000-8000-000000000102', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000003-0000-4000-8000-000000000002', 'pending'),
  ('de000006-0000-4000-8000-000000000103', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000003-0000-4000-8000-000000000003', 'pending'),
  ('de000006-0000-4000-8000-000000000104', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000003-0000-4000-8000-000000000005', 'pending')
ON CONFLICT (id) DO NOTHING;

-- In-progress check: 2 assets, one mid-job
INSERT INTO public.check_assets (id, tenant_id, check_id, asset_id, status) VALUES
  ('de000006-0000-4000-8000-000000000201', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000003-0000-4000-8000-000000000001', 'in_progress'),
  ('de000006-0000-4000-8000-000000000202', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000003-0000-4000-8000-000000000005', 'pending')
ON CONFLICT (id) DO NOTHING;

-- Complete check: 1 asset, signed off
INSERT INTO public.check_assets (id, tenant_id, check_id, asset_id, status, completed_at) VALUES
  ('de000006-0000-4000-8000-000000000301', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000003', 'de000003-0000-4000-8000-000000000001', 'complete', NOW() - INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;

-- ── 6. Check items — inline so we don't need to seed a job plan ──
-- Five items per asset on the scheduled check, six on the in-progress
-- check (with a few pre-passed so the tech sees mid-job state).

-- Scheduled check, asset 1 (MSB-1) — all pending
INSERT INTO public.maintenance_check_items (id, tenant_id, check_id, check_asset_id, asset_id, description, sort_order, is_required, result) VALUES
  ('de000005-0000-4000-8000-000000000101', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000006-0000-4000-8000-000000000101', 'de000003-0000-4000-8000-000000000001', 'Visual inspection — covers, doors, gauges', 10, true, NULL),
  ('de000005-0000-4000-8000-000000000102', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000006-0000-4000-8000-000000000101', 'de000003-0000-4000-8000-000000000001', 'Check labels and signage are current', 20, true, NULL),
  ('de000005-0000-4000-8000-000000000103', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000006-0000-4000-8000-000000000101', 'de000003-0000-4000-8000-000000000001', 'Thermographic scan with FLIR — record image of any hot spots', 30, true, NULL),
  ('de000005-0000-4000-8000-000000000104', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000006-0000-4000-8000-000000000101', 'de000003-0000-4000-8000-000000000001', 'Check earthing connections — visual + torque check', 40, true, NULL),
  ('de000005-0000-4000-8000-000000000105', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000001', 'de000006-0000-4000-8000-000000000101', 'de000003-0000-4000-8000-000000000001', 'Record any defects found — raise with photo', 50, false, NULL)
ON CONFLICT (id) DO NOTHING;

-- In-progress check, asset 1 (MSB-1) — 3 passed, 1 failed, 2 pending
INSERT INTO public.maintenance_check_items (id, tenant_id, check_id, check_asset_id, asset_id, description, sort_order, is_required, result, notes, completed_at) VALUES
  ('de000005-0000-4000-8000-000000000201', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201', 'de000003-0000-4000-8000-000000000001', 'Visual inspection of enclosure', 10, true, 'pass', NULL, NOW() - INTERVAL '1 hour'),
  ('de000005-0000-4000-8000-000000000202', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201', 'de000003-0000-4000-8000-000000000001', 'Verify Arc Flash labels are in place', 20, true, 'pass', NULL, NOW() - INTERVAL '1 hour'),
  ('de000005-0000-4000-8000-000000000203', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201', 'de000003-0000-4000-8000-000000000001', 'Check operation of door interlocks', 30, true, 'pass', 'Both door interlocks operating correctly', NOW() - INTERVAL '50 minutes'),
  ('de000005-0000-4000-8000-000000000204', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201', 'de000003-0000-4000-8000-000000000001', 'Inspect indicator lamps + replace any failed', 40, true, 'fail', 'Phase B indicator lamp dim — replacement needed', NOW() - INTERVAL '30 minutes'),
  ('de000005-0000-4000-8000-000000000205', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201', 'de000003-0000-4000-8000-000000000001', 'Thermographic scan — document any anomalies', 50, true, NULL, NULL, NULL),
  ('de000005-0000-4000-8000-000000000206', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201', 'de000003-0000-4000-8000-000000000001', 'Test emergency stop function', 60, true, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ── 7. Defects ───────────────────────────────────────────────────
-- Two defects so the tech sees the register populated.
INSERT INTO public.defects (
  id, tenant_id, check_id, check_asset_id, asset_id, site_id,
  title, description, severity, status, source
) VALUES
  -- Open defect linked to the in-progress check
  ('de000007-0000-4000-8000-000000000001', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
   'de000004-0000-4000-8000-000000000002', 'de000006-0000-4000-8000-000000000201',
   'de000003-0000-4000-8000-000000000001', 'de000002-0000-4000-8000-000000000001',
   'DEMO — Phase B indicator lamp failed', 'Phase B indicator lamp on MSB-1 is dim/intermittent. Bulb replacement needed at next visit.',
   'low', 'open', 'manual'),
  -- Open defect on a different asset
  ('de000007-0000-4000-8000-000000000002', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8',
   NULL, NULL,
   'de000003-0000-4000-8000-000000000004', 'de000002-0000-4000-8000-000000000001',
   'DEMO — NSX-1 trip indicator stuck', 'NSX-1 trip indicator did not reset after operation. Trip unit may need replacement.',
   'medium', 'open', 'manual')
ON CONFLICT (id) DO NOTHING;

COMMIT;
