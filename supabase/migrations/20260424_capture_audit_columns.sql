-- Audit provenance on captures: where did this value come from?
--
-- 'web'           — captured via per-asset web UI
-- 'file_reimport' — captured by re-uploading a filled Equinix template
--
-- source_file carries the filename of the source workbook (only set when
-- source='file_reimport'). Enables audit trail back to the original
-- artefact the tech filled out on site.

alter table public.captures
  add column if not exists source text not null default 'web',
  add column if not exists source_file text;

alter table public.captures
  drop constraint if exists captures_source_check;

alter table public.captures
  add constraint captures_source_check
  check (source in ('web', 'file_reimport'));

-- Existing rows predate re-import → they're from the web UI. Default
-- already did this but be explicit for any future reviewer.
update public.captures set source = 'web' where source is null;

comment on column public.captures.source is
  'Provenance of this capture: ''web'' (per-asset UI) or ''file_reimport'' (filled Equinix template).';
comment on column public.captures.source_file is
  'Filename of the source workbook when source=''file_reimport''. NULL otherwise.';
