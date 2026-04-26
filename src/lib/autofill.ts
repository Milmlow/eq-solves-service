// ============================================================================
// Schneider ACB / MCCB autofill
//
// Reads the manufacturer + model already populated in the spreadsheet and
// derives 5 fields the tech would otherwise have to type:
//   • Amp Frame
//   • kA Rating  
//   • Voltage Rating
//   • Construction
//   • Mount
//
// Coverage across Equinix AU sites: 497 of 505 breakers (98%). Unparseable
// rows just fall through silently — the tech captures them manually.
//
// Conventions used:
//   • MTZ family: number after letters × 100 = amp frame (MTZ2-40 → 4000A)
//   • NW  family: number after NW × 100 = amp frame (NW16 → 1600A)
//   • NS  family: number IS the amp frame (NS1600 → 1600A)
//   • Letter suffix → kA rating at AU LV (415V) Icu level
//   • All ACBs use 690V max rating per Equinix brief direction
//   • MTZ/NW are draw-out by default; NS varies (left blank to verify)
// ============================================================================

/** Field IDs (display_name -> id mapping happens at the call site). */
export type AutofillFieldKey =
  | 'amp_frame'
  | 'ka_rating'
  | 'voltage_rating'
  | 'breaker_construction'
  | 'breaker_mount'

/** Derived values, keyed by field. Empty record = nothing inferred. */
export type AutofillResult = Partial<Record<AutofillFieldKey, string>>

/** Schneider kA rating letter codes at AU LV (415V) Icu level. */
const KA_BY_LETTER: Record<string, number> = {
  N1: 42,
  N2: 50,
  H1: 65,
  H2: 100,
  H3: 150,
  HA: 65, // older NW alt-spec
  HF: 50, // NW HF rating
  L1: 150,
}

/** NS family kA codes (Compact NS — moulded case). */
const NS_KA_BY_LETTER: Record<string, number> = {
  N: 50,
  H: 70,
  L: 150,
  NA: 50, // N + Ammeter variant
}

/**
 * Parse a Schneider model string into derived field values.
 * Returns an empty object if the model is not recognised — never throws.
 */
export function parseModel(manufacturer: string | null | undefined, model: string | null | undefined): AutofillResult {
  if (!model) return {}
  if ((manufacturer || '').trim().toUpperCase() !== 'SCHNEIDER') return {}

  const m = model
    .toUpperCase()
    .replace('MASTERPACT', '')
    .replace('(CHASSIS ONLY)', '')
    .trim()

  // --- MTZ family (Masterpact MTZ — modern ACB) ---
  // Examples: MTZ2-40 H1, MTZ2 - 40 H1, MTZ3-63H1 3P, MTZ50H1, MTZ1-08 H3, MTZ2-20-HA
  const mtz = /^MTZ\s*([123])?\s*[-\s]*(\d{1,3})\s*[-\s]*([A-Z][A-Z0-9]?)/.exec(m)
  if (mtz) {
    const size = parseInt(mtz[2], 10)
    const ka = mtz[3]
    const out: AutofillResult = {
      amp_frame: String(size * 100),
      voltage_rating: '690',
      breaker_construction: 'ACB - AIR CIRCUIT BREAKER',
      breaker_mount: 'DRAWOUT',
    }
    if (KA_BY_LETTER[ka] !== undefined) out.ka_rating = String(KA_BY_LETTER[ka])
    return out
  }

  // --- NW family (older Masterpact NW — ACB) ---
  // Examples: NW16 H1, NW32 HF, NW40H1, NW20 H1, NW25 HF
  const nw = /^NW\s*(\d{2})\s*([A-Z][A-Z0-9]?)?/.exec(m)
  if (nw) {
    const size = parseInt(nw[1], 10)
    const ka = (nw[2] || '').trim()
    const out: AutofillResult = {
      amp_frame: String(size * 100),
      voltage_rating: '690',
      breaker_construction: 'ACB - AIR CIRCUIT BREAKER',
      breaker_mount: 'DRAWOUT',
    }
    if (KA_BY_LETTER[ka] !== undefined) out.ka_rating = String(KA_BY_LETTER[ka])
    return out
  }

  // --- NS family (Compact NS — MCCB) ---
  // Examples: NS1600NA, NS1600N, NS 1600N, NS800 N, NS1000N
  const ns = /^NS\s*(\d{3,4})\s*([A-Z]+)?/.exec(m)
  if (ns) {
    const size = parseInt(ns[1], 10)
    const kaLetter = (ns[2] || '').trim()
    const out: AutofillResult = {
      amp_frame: String(size),
      voltage_rating: '690',
      breaker_construction: 'MCCB - MOLDED CASE',
      // mount intentionally omitted — NS comes in fixed AND drawout, leave for tech to verify
    }
    if (NS_KA_BY_LETTER[kaLetter] !== undefined) out.ka_rating = String(NS_KA_BY_LETTER[kaLetter])
    else if (kaLetter && NS_KA_BY_LETTER[kaLetter[0]] !== undefined) {
      out.ka_rating = String(NS_KA_BY_LETTER[kaLetter[0]])
    }
    return out
  }

  return {}
}

// ============================================================================
// Field-name matching
//
// The autofill engine outputs canonical keys (amp_frame, ka_rating, etc.)
// but the database schema names display fields by their natural-language
// label (e.g. "AMP FRAME", "KA RATING"). This map fuzzy-matches a display
// name to a canonical autofill key.
// ============================================================================

/**
 * Match a ClassificationField display_name to one of our canonical keys.
 * Returns null if the field isn't an autofill candidate.
 */
export function matchFieldKey(displayName: string): AutofillFieldKey | null {
  const n = displayName.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

  if (n.includes('amp frame')) return 'amp_frame'
  if (n.startsWith('ka ') || n.includes(' ka ') || n === 'ka rating') return 'ka_rating'
  if (n.includes('voltage rating')) return 'voltage_rating'
  if (n.startsWith('construction') || n.includes('breaker construction') || n.includes('breaker constr')) {
    return 'breaker_construction'
  }
  if (n.includes('breaker mount') || n === 'mount') return 'breaker_mount'

  return null
}

// ============================================================================
// Per-asset autofill
// ============================================================================

export interface AutofillSuggestion {
  fieldId: number
  fieldKey: AutofillFieldKey
  value: string
}

/**
 * Compute all autofill suggestions for an asset, given the available fields.
 * Pure function — does not write to the queue.
 *
 * Caller decides what to do with the result (typically: render as 'pending'
 * in FieldEditor and let the tech tap to confirm on the nameplate).
 */
export function computeAutofillSuggestions(
  asset: { manufacturer: string | null | undefined; model: string | null | undefined },
  fields: ReadonlyArray<{ id: number; display_name: string; is_field_captured: boolean }>,
): AutofillSuggestion[] {
  const derived = parseModel(asset.manufacturer, asset.model)
  if (Object.keys(derived).length === 0) return []

  const out: AutofillSuggestion[] = []
  for (const f of fields) {
    if (!f.is_field_captured) continue
    const key = matchFieldKey(f.display_name)
    if (!key) continue
    const value = derived[key]
    if (value === undefined) continue
    out.push({ fieldId: f.id, fieldKey: key, value })
  }
  return out
}
