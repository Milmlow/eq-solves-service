# Canonical schema mirrors

Copies of the canonical JSON Schemas published by **eq-solves-intake**.
Source of truth: https://github.com/Milmlow/eq-solves-intake/tree/main/schemas

These files are mirrored here so the admin Delta importer can ajv-validate
canonical projections without a runtime dependency on the schema repo.

When the schema in eq-solves-intake/main changes, re-copy the file here and
bump any related code. The validator in `../canonical-validate.ts` loads
them at module-init time; mismatched copies will be caught by the
round-trip smoke test (`tests/lib/import/delta-canonical-roundtrip.test.ts`).

Currently mirrored:

- `maintenance_check.schema.json` — service/maintenance-check/v1.json
- `check_asset.schema.json` — service/check-asset/v1.json
