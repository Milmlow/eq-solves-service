import { supabase } from './supabase'

// ============================================================================
// Offline-first capture queue
//
// Philosophy: writes are the critical path in a data hall. Every capture lands
// in localStorage IMMEDIATELY (sync operation). A background worker drains the
// queue to Supabase when online. UI shows queue length + sync status.
// Nothing is "saved" in the UI's sense until it's synced — but nothing is lost
// if the device loses signal.
// ============================================================================

export interface QueuedCapture {
  localId: string                // deterministic per (asset, field)
  jobId: string
  assetId: string
  classificationFieldId: number
  value: string | null
  capturedBy: string | null
  capturedAt: string
  notes: string | null
  flagged: boolean
  synced: boolean
  syncedAt?: string
  attempts: number
  lastError?: string
}

const QUEUE_KEY = 'eq-capture-queue-v1'
const LISTENERS = new Set<() => void>()

function read(): QueuedCapture[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueuedCapture[]) : []
  } catch {
    return []
  }
}

function write(items: QueuedCapture[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
  LISTENERS.forEach((fn) => fn())
}

export function subscribeQueue(fn: () => void): () => void {
  LISTENERS.add(fn)
  return () => LISTENERS.delete(fn)
}

export function allCaptures(): QueuedCapture[] {
  return read()
}

export function pendingCount(): number {
  return read().filter((c) => !c.synced).length
}

export function captureFor(assetId: string, classificationFieldId: number): QueuedCapture | undefined {
  return read().find((c) => c.assetId === assetId && c.classificationFieldId === classificationFieldId)
}

export function capturesForAsset(assetId: string): QueuedCapture[] {
  return read().filter((c) => c.assetId === assetId)
}

export function enqueueCapture(opts: {
  jobId: string
  assetId: string
  classificationFieldId: number
  value: string | null
  capturedBy: string | null
  notes?: string | null
  flagged?: boolean
}): QueuedCapture {
  const items = read()
  const localId = `${opts.assetId}:${opts.classificationFieldId}`
  const now = new Date().toISOString()
  const existing = items.find((i) => i.localId === localId)
  let row: QueuedCapture
  if (existing) {
    existing.value = opts.value
    existing.capturedBy = opts.capturedBy
    existing.notes = opts.notes ?? existing.notes ?? null
    existing.flagged = opts.flagged ?? existing.flagged
    existing.capturedAt = now
    existing.synced = false
    existing.attempts = 0
    existing.lastError = undefined
    row = existing
  } else {
    row = {
      localId,
      jobId: opts.jobId,
      assetId: opts.assetId,
      classificationFieldId: opts.classificationFieldId,
      value: opts.value,
      capturedBy: opts.capturedBy,
      capturedAt: now,
      notes: opts.notes ?? null,
      flagged: opts.flagged ?? false,
      synced: false,
      attempts: 0,
    }
    items.push(row)
  }
  write(items)
  // Fire-and-forget sync
  void syncPending()
  return row
}

/**
 * Bulk enqueue. Skips per-write sync trigger and writes localStorage once
 * at the end. Use for blanket-fill / paste-batch / "Copy prev" — anything
 * that touches many fields at once. Triggers a single sync at the end.
 *
 * Same upsert semantics as enqueueCapture: existing (assetId, fieldId)
 * rows are updated in place.
 */
export function enqueueBatch(
  rows: ReadonlyArray<{
    jobId: string
    assetId: string
    classificationFieldId: number
    value: string | null
    capturedBy: string | null
    notes?: string | null
    flagged?: boolean
  }>,
): QueuedCapture[] {
  if (rows.length === 0) return []
  const items = read()
  const now = new Date().toISOString()
  const written: QueuedCapture[] = []

  for (const opts of rows) {
    const localId = `${opts.assetId}:${opts.classificationFieldId}`
    const existing = items.find((i) => i.localId === localId)
    if (existing) {
      existing.value = opts.value
      existing.capturedBy = opts.capturedBy
      existing.notes = opts.notes ?? existing.notes ?? null
      existing.flagged = opts.flagged ?? existing.flagged
      existing.capturedAt = now
      existing.synced = false
      existing.attempts = 0
      existing.lastError = undefined
      written.push(existing)
    } else {
      const row: QueuedCapture = {
        localId,
        jobId: opts.jobId,
        assetId: opts.assetId,
        classificationFieldId: opts.classificationFieldId,
        value: opts.value,
        capturedBy: opts.capturedBy,
        capturedAt: now,
        notes: opts.notes ?? null,
        flagged: opts.flagged ?? false,
        synced: false,
        attempts: 0,
      }
      items.push(row)
      written.push(row)
    }
  }
  write(items)
  void syncPending()
  return written
}

let syncInFlight = false

export async function syncPending(): Promise<{ ok: boolean; synced: number; failed: number }> {
  if (syncInFlight) return { ok: true, synced: 0, failed: 0 }
  if (!navigator.onLine) return { ok: false, synced: 0, failed: 0 }
  syncInFlight = true
  try {
    const items = read()
    const pending = items.filter((i) => !i.synced)
    if (!pending.length) return { ok: true, synced: 0, failed: 0 }

    let synced = 0
    let failed = 0

    // Batch upsert — one network call for the whole pending set
    const payload = pending.map((p) => ({
      asset_id: p.assetId,
      classification_field_id: p.classificationFieldId,
      value: p.value,
      captured_by: p.capturedBy,
      captured_at: p.capturedAt,
      notes: p.notes,
      flagged: p.flagged,
    }))

    const { error } = await supabase
      .from('captures')
      // Cast: the generated Database types are intentionally wide; the shape
      // here matches the captures schema exactly.
      .upsert(payload as never, { onConflict: 'asset_id,classification_field_id' })

    if (error) {
      failed = pending.length
      pending.forEach((p) => {
        p.attempts += 1
        p.lastError = error.message
      })
      write(items)
      return { ok: false, synced, failed }
    }

    const now = new Date().toISOString()
    pending.forEach((p) => {
      p.synced = true
      p.syncedAt = now
      p.attempts += 1
      p.lastError = undefined
    })
    synced = pending.length
    write(items)
    return { ok: true, synced, failed: 0 }
  } finally {
    syncInFlight = false
  }
}

// Auto-sync triggers
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void syncPending()
  })
  // Periodic nudge every 30s
  setInterval(() => {
    if (navigator.onLine && pendingCount() > 0) void syncPending()
  }, 30_000)
}
