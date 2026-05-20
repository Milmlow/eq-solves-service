/**
 * Canonical-shape ajv validator for the admin Delta importer.
 *
 * The schemas live in `./schemas/` and are mirrors of the canonical JSON
 * Schemas published by eq-solves-intake. We compile them once at
 * module-init time (Ajv2020 — schemas are draft-2020-12) and expose
 * per-entity `validate*` helpers that return a flat, user-readable shape
 * the preview UI can render inline.
 *
 * Unknown `x-eq-*` keywords are ignored (strict: false) — the canonical
 * schemas use them for FK hints, source aliases, and coercion notes. They
 * have no effect on validation.
 */
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import maintenanceCheckSchema from './schemas/maintenance_check.schema.json'
import checkAssetSchema from './schemas/check_asset.schema.json'

export interface CanonicalValidationError {
  /** JSON Pointer path inside the row (e.g. `/status`). */
  path: string
  message: string
}

export interface CanonicalValidationResult {
  valid: boolean
  errors: CanonicalValidationError[]
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  // Don't fail on the `x-eq-*` extension keywords we use for source aliases,
  // FK hints, etc. Ajv2020 default mode warns on unknown keywords.
  strictSchema: false,
})
addFormats(ajv)

const validateMaintenanceCheckFn = ajv.compile(maintenanceCheckSchema)
const validateCheckAssetFn = ajv.compile(checkAssetSchema)

function shapeErrors(errors: typeof validateMaintenanceCheckFn.errors): CanonicalValidationError[] {
  if (!errors) return []
  return errors.map((e) => ({
    path: e.instancePath || '/',
    message: e.message ?? 'invalid',
  }))
}

export function validateMaintenanceCheck(row: unknown): CanonicalValidationResult {
  const ok = validateMaintenanceCheckFn(row)
  return { valid: !!ok, errors: shapeErrors(validateMaintenanceCheckFn.errors) }
}

export function validateCheckAsset(row: unknown): CanonicalValidationResult {
  const ok = validateCheckAssetFn(row)
  return { valid: !!ok, errors: shapeErrors(validateCheckAssetFn.errors) }
}

/** Schema $ids the validator was compiled against — surfaced for telemetry. */
export const VALIDATOR_SCHEMA_IDS = {
  maintenance_check: (maintenanceCheckSchema as { $id: string }).$id,
  check_asset: (checkAssetSchema as { $id: string }).$id,
} as const
