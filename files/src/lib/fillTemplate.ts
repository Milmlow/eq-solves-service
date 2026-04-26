// ============================================================================
// Fill template
//
// When the tech captures one breaker fully and wants to apply its values to
// many similar breakers (e.g. 50 identical Masterpact MTZ2-40 incomers in a
// row), they tap "Set as template" on the captured asset. That value-set is
// stashed here, scoped to the current job. From the AssetList they can then
// multi-select the lookalike breakers and apply.
//
// Each filled value lands in the queue as a normal capture, marked
// flagged=true with notes pointing back to the source asset so the office
// can see the lineage. The tech walks each one, confirms or edits, clears
// the flag — using the existing per-field flag UX, no new concepts.
// ============================================================================

const STORAGE_PREFIX = 'eq-fill-template:'
const LISTENERS = new Set<() => void>()

export interface FillTemplate {
  sourceAssetId: string
  sourceAssetLabel: string         // human-readable for UI ("#1076" or asset_id)
  classificationCode: string       // only apply to assets in the same class
  values: Record<number, string>   // classificationFieldId -> value
  capturedAt: string               // when the template was set
}

function key(jobId: string): string {
  return `${STORAGE_PREFIX}${jobId}`
}

function notify() {
  LISTENERS.forEach((fn) => fn())
}

export function subscribeFillTemplate(fn: () => void): () => void {
  LISTENERS.add(fn)
  return () => LISTENERS.delete(fn)
}

export function getFillTemplate(jobId: string): FillTemplate | null {
  try {
    const raw = localStorage.getItem(key(jobId))
    if (!raw) return null
    return JSON.parse(raw) as FillTemplate
  } catch {
    return null
  }
}

export function setFillTemplate(
  jobId: string,
  payload: Omit<FillTemplate, 'capturedAt'>,
): FillTemplate {
  const tpl: FillTemplate = { ...payload, capturedAt: new Date().toISOString() }
  localStorage.setItem(key(jobId), JSON.stringify(tpl))
  notify()
  return tpl
}

export function clearFillTemplate(jobId: string): void {
  localStorage.removeItem(key(jobId))
  notify()
}

/** Cross-tab sync — if another tab sets/clears the template, refresh here too. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(STORAGE_PREFIX)) notify()
  })
}
