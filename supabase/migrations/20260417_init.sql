-- ============================================================================
-- EQ Asset Capture — initial schema
-- Purpose: reusable IAM asset data collection for data centre sites
-- ============================================================================

-- Classifications (BREAKER, CRAC, UPSS, etc.) — taken from Equinix template
create table if not exists public.classifications (
  code              text primary key,
  description       text,
  failure_class     text,
  life_expectancy   int,
  cost_parent_id    text,
  aux_id            text,
  notes             text,
  created_at        timestamptz not null default now()
);

-- One row per (classification, field). Defines the green-cell schema for a
-- given asset type. Adding a classification = insert rows here — no code change.
create table if not exists public.classification_fields (
  id                    bigserial primary key,
  classification_code   text not null references public.classifications(code) on delete cascade,
  spec_id               text not null,  -- canonical header matching the Equinix workbook
  display_name          text not null,
  definition            text,
  sample_values         text,
  data_type             text not null default 'FREETEXT', -- LOV | NUM | FREETEXT | DATE | CURRENCY
  display_order         int  not null default 0,
  is_field_captured     boolean not null default true,  -- green vs office
  field_group           text,                            -- Mechanical / Electrical / etc.
  options               text[] not null default '{}'::text[],
  created_at            timestamptz not null default now(),
  unique (classification_code, spec_id)
);
create index if not exists idx_cf_classification on public.classification_fields(classification_code);

-- A job is one asset-capture campaign: a site + classification + source template.
create table if not exists public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  site_code             text not null,       -- SY6
  client_code           text not null,       -- generic: DCCA (Data Centre Client A)
  classification_code   text not null references public.classifications(code),
  name                  text,                -- "SY6 Breakers — March 2026"
  template_filename     text,
  pin_hash              text,                -- SHA-256 hex of salted PIN (null = no PIN required)
  pin_salt              text,                -- random per-job salt
  created_at            timestamptz not null default now(),
  active                boolean not null default true
);
create index if not exists idx_jobs_active on public.jobs(active);

-- The pre-loaded asset list for a job. Back-office cols are pre-filled here.
create table if not exists public.assets (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.jobs(id) on delete cascade,
  row_number            int not null,
  asset_uid             text,
  asset_id              text,
  description           text not null,
  classification_code   text not null,
  location_id           text,
  location_description  text,
  manufacturer          text,
  model                 text,
  serial                text,
  source_row            jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  unique (job_id, row_number)
);
create index if not exists idx_assets_job on public.assets(job_id);
create index if not exists idx_assets_desc on public.assets(description);

-- Captured data. One row per (asset, field).
create table if not exists public.captures (
  id                        uuid primary key default gen_random_uuid(),
  asset_id                  uuid not null references public.assets(id) on delete cascade,
  classification_field_id   bigint not null references public.classification_fields(id),
  value                     text,
  captured_by               text,
  captured_at               timestamptz not null default now(),
  flagged                   boolean not null default false,
  notes                     text,
  unique (asset_id, classification_field_id)
);
create index if not exists idx_captures_asset on public.captures(asset_id);

-- Photos (optional in Phase 1 but schema ready)
create table if not exists public.capture_photos (
  id                        uuid primary key default gen_random_uuid(),
  asset_id                  uuid not null references public.assets(id) on delete cascade,
  classification_field_id   bigint references public.classification_fields(id),
  storage_path              text not null,
  caption                   text,
  captured_at               timestamptz not null default now()
);
create index if not exists idx_photos_asset on public.capture_photos(asset_id);

-- ============================================================================
-- RLS — open for Phase 1 single-URL-per-job model. No auth by design.
-- This is deliberate. Treat URLs as the access token. Tighten in Phase 2.
-- ============================================================================
alter table public.classifications          enable row level security;
alter table public.classification_fields    enable row level security;
alter table public.jobs                     enable row level security;
alter table public.assets                   enable row level security;
alter table public.captures                 enable row level security;
alter table public.capture_photos           enable row level security;

-- Read-all for anon (necessary so the form can load the schema + asset list)
drop policy if exists "anon_read_classifications" on public.classifications;
create policy "anon_read_classifications"
  on public.classifications for select using (true);
drop policy if exists "anon_read_fields" on public.classification_fields;
create policy "anon_read_fields"
  on public.classification_fields for select using (true);
drop policy if exists "anon_read_jobs" on public.jobs;
create policy "anon_read_jobs"
  on public.jobs for select using (active);
drop policy if exists "anon_read_assets" on public.assets;
create policy "anon_read_assets"
  on public.assets for select using (true);
drop policy if exists "anon_read_captures" on public.captures;
create policy "anon_read_captures"
  on public.captures for select using (true);

-- Anon can upsert captures (the point of the app). No deletes.
drop policy if exists "anon_insert_captures" on public.captures;
create policy "anon_insert_captures"
  on public.captures for insert with check (true);
drop policy if exists "anon_update_captures" on public.captures;
create policy "anon_update_captures"
  on public.captures for update using (true) with check (true);

drop policy if exists "anon_insert_photos" on public.capture_photos;
create policy "anon_insert_photos"
  on public.capture_photos for insert with check (true);

-- ============================================================================
-- Helper view: per-asset completeness
-- ============================================================================
create or replace view public.v_asset_progress as
select
  a.id             as asset_id,
  a.job_id,
  a.description,
  a.classification_code,
  (select count(*) from public.classification_fields cf
   where cf.classification_code = a.classification_code
     and cf.is_field_captured)                        as fields_required,
  (select count(*) from public.captures c
   join public.classification_fields cf on cf.id = c.classification_field_id
   where c.asset_id = a.id
     and cf.is_field_captured
     and c.value is not null and c.value <> '')      as fields_complete
from public.assets a;

grant select on public.v_asset_progress to anon;
