import { useEffect, useMemo, useRef, useState } from 'react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { TopBar } from '../components/TopBar'
import { enqueueCapture, captureFor, subscribeQueue, capturesForAsset } from '../lib/queue'
import { PhotoPicker } from '../components/PhotoPicker'
import { EqMark } from '../components/EqMark'
import { SiteInfoSheet } from '../components/SiteInfoSheet'
import { CAPTURED_BY_KEY, CAPTURER_ROSTER } from '../lib/constants'
import type { Asset, ClassificationField } from '../types/db'

// Sticky per-device capturer name + roster moved to src/lib/constants.ts
// so the OverflowMenu can reference CAPTURED_BY_KEY without importing from a page.

export function AssetPage({ jobRef, assetId }: { jobRef: string; assetId: string }) {
  const { job } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets } = useAssets(jobId)
  const { fields, loading: fieldsLoading } = useFields(job?.classification_code ?? null)

  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick((v) => v + 1)), [])

  const asset = assets.find((a) => a.id === assetId)
  const fieldCaptured = useMemo(() => fields.filter((f) => f.is_field_captured), [fields])

  const [siteInfoOpen, setSiteInfoOpen] = useState(false)

  // Capturer name (sticky per device).
  // We intentionally revalidate on every mount and listen for storage changes
  // so that signing out (elsewhere in the app or in another tab) immediately
  // forces a re-prompt the next time the user lands here.
  const [capturedBy, setCapturedBy] = useState<string>(() => localStorage.getItem(CAPTURED_BY_KEY) ?? '')
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(
    () => !localStorage.getItem(CAPTURED_BY_KEY),
  )

  useEffect(() => {
    // Re-read on mount in case something cleared the key between renders
    const current = localStorage.getItem(CAPTURED_BY_KEY) ?? ''
    if (current !== capturedBy) setCapturedBy(current)
    if (!current && !showNamePrompt) setShowNamePrompt(true)

    // Cross-context invalidation: another tab/page signing out fires a
    // 'storage' event. Same-tab sign-outs fire a custom event we dispatch
    // from the menu/home page.
    const onStorage = (e: StorageEvent) => {
      if (e.key === CAPTURED_BY_KEY && !e.newValue) {
        setCapturedBy('')
        setShowNamePrompt(true)
      }
    }
    const onLocalSignout = () => {
      setCapturedBy('')
      setShowNamePrompt(true)
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('eq:signout', onLocalSignout)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('eq:signout', onLocalSignout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!asset) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopBar title="Loading asset…" onBack={() => navigate(`/j/${jobRef}`)} />
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          {assets.length === 0 ? 'Loading…' : 'Asset not found'}
        </div>
      </div>
    )
  }

  if (showNamePrompt) {
    return (
      <NamePrompt
        onDone={(name) => {
          localStorage.setItem(CAPTURED_BY_KEY, name)
          setCapturedBy(name)
          setShowNamePrompt(false)
        }}
        // Allow cancel only if they already have a name on file (i.e. they
        // opened the picker to change it rather than being forced in at start)
        onCancel={capturedBy ? () => setShowNamePrompt(false) : undefined}
      />
    )
  }

  // Group fields by display_order grouping — use the "group" field if present,
  // otherwise infer Trip Settings vs Nameplate from display_name for BREAKER
  const groups = groupFields(fieldCaptured, asset.classification_code)

  // Progress
  const local = capturesForAsset(asset.id)
  const completeIds = new Set(
    local.filter((c) => c.value && c.value !== '').map((c) => c.classificationFieldId),
  )
  const done = fieldCaptured.filter((f) => completeIds.has(f.id)).length
  const total = fieldCaptured.length

  return (
    <div className="min-h-screen flex flex-col pb-24">
      <TopBar
        title={asset.description}
        subtitle={`${done}/${total} captured · as ${capturedBy}`}
        onBack={() => navigate(`/j/${jobRef}`)}
        showChangeName
        onChangeName={() => setShowNamePrompt(true)}
      />

      {/* Asset header card */}
      <div className="px-4 pt-4">
        <div className="card p-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info label="Asset ID" value={asset.asset_id} mono />
            <Info label="Location" value={asset.location_description} />
            <Info label="Manufacturer" value={asset.manufacturer} />
            <Info label="Model" value={asset.model} mono />
            <Info label="Serial" value={asset.serial} mono />
            <Info label="Classification" value={asset.classification_code} />
          </div>
          {job?.site_code ? (
            <button
              onClick={() => setSiteInfoOpen(true)}
              className="mt-3 pt-3 border-t border-border/60 w-full flex items-center gap-2 text-sm text-sky-deep hover:text-sky font-semibold"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>Can't find this asset? · Site info</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Copy from previous asset */}
      {jobId && capturedBy && done === 0 ? (
        <CopyFromPrevious
          jobId={jobId}
          capturedBy={capturedBy}
          currentAsset={asset}
          assets={assets}
          fieldCaptured={fieldCaptured}
        />
      ) : null}

      {/* Field groups */}
      <div className="flex-1 px-4 pt-4 space-y-6">
        {fieldsLoading ? (
          <div className="text-center text-muted py-12">Loading fields…</div>
        ) : (
          groups.map((group) => (
            <section key={group.title}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted px-1 mb-2">
                {group.title}{' '}
                <span className="font-normal normal-case tracking-normal">
                  · {group.fields.filter((f) => completeIds.has(f.id)).length}/{group.fields.length}
                </span>
              </h2>
              <div className="card divide-y divide-border/60">
                {group.fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    existing={captureFor(asset.id, field.id)}
                    onChange={(value, opts) => {
                      if (!jobId) return
                      enqueueCapture({
                        jobId,
                        assetId: asset.id,
                        classificationFieldId: field.id,
                        value,
                        capturedBy,
                        flagged: opts?.flagged,
                        notes: opts?.notes,
                      })
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Photos */}
      {jobId ? (
        <div className="pt-6">
          <PhotoPicker assetId={asset.id} jobId={jobId} />
        </div>
      ) : null}

      {/* Sticky footer with next/prev */}
      <AssetFooter
        jobRef={jobRef}
        assets={assets}
        currentId={asset.id}
        done={done}
        total={total}
      />

      {siteInfoOpen && job?.site_code ? (
        <SiteInfoSheet siteCode={job.site_code} onClose={() => setSiteInfoOpen(false)} />
      ) : null}
    </div>
  )
}

// ----------------------------------------------------------------------------

function NamePrompt({ onDone, onCancel }: { onDone: (name: string) => void; onCancel?: () => void }) {
  const [mode, setMode] = useState<'roster' | 'other'>('roster')
  const [otherValue, setOtherValue] = useState('')
  const otherRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'other') otherRef.current?.focus()
  }, [mode])

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm card p-5 relative">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-sky-soft flex items-center justify-center text-muted"
            aria-label="Cancel"
            title="Cancel"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
        <div className="flex items-center gap-2 mb-1">
          <EqMark size={18} aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Asset Capture</span>
        </div>
        <h1 className="font-bold text-lg mb-1">Who's capturing?</h1>
        <p className="text-sm text-muted mb-4">
          We tag every entry with your name so the office knows who to ask if something looks off.
        </p>

        {mode === 'roster' ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 max-h-[50vh] overflow-y-auto -mx-1 px-1">
              {CAPTURER_ROSTER.map((name) => (
                <button
                  key={name}
                  onClick={() => onDone(name)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-border bg-white hover:border-sky/60 hover:bg-sky-soft/50 active:scale-[0.99] transition"
                >
                  <span className="font-semibold text-ink">{name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setMode('other')}
              className="w-full text-left px-4 py-3 rounded-xl border border-dashed border-border hover:border-sky/60 text-muted hover:text-ink"
            >
              + Someone else
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={otherRef}
              value={otherValue}
              onChange={(e) => setOtherValue(e.target.value)}
              placeholder="Type your full name"
              className="field-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && otherValue.trim()) onDone(otherValue.trim())
              }}
            />
            <div className="flex gap-2">
              <button onClick={() => setMode('roster')} className="btn btn-ghost btn-lg flex-1">
                Back
              </button>
              <button
                disabled={!otherValue.trim()}
                onClick={() => onDone(otherValue.trim())}
                className="btn btn-primary btn-lg flex-[2] disabled:opacity-40"
              >
                Start capturing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Info({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-sm text-ink ${mono ? 'mono' : ''} truncate`}>{value ?? '—'}</div>
    </div>
  )
}

function AssetFooter({
  jobRef,
  assets,
  currentId,
  done,
  total,
}: {
  jobRef: string
  assets: Asset[]
  currentId: string
  done: number
  total: number
}) {
  const idx = assets.findIndex((a) => a.id === currentId)
  const prev = idx > 0 ? assets[idx - 1] : null
  const next = idx >= 0 && idx < assets.length - 1 ? assets[idx + 1] : null
  const complete = total > 0 && done === total
  return (
    <div className="fixed bottom-0 left-0 right-0 safe-bottom bg-white/95 backdrop-blur border-t border-border z-10">
      <div className="max-w-lg mx-auto flex items-stretch gap-2 p-3">
        <button
          onClick={() => prev && navigate(`/j/${jobRef}/a/${prev.id}`)}
          disabled={!prev}
          className="btn btn-ghost btn-md flex-1 disabled:opacity-30"
          aria-label="Previous asset"
        >
          ← Prev
        </button>
        <button
          onClick={() => navigate(`/j/${jobRef}`)}
          className={`btn btn-md flex-1 ${complete ? 'btn-primary' : 'btn-ghost'}`}
        >
          {complete ? '✓ Done' : 'Save & back'}
        </button>
        <button
          onClick={() => next && navigate(`/j/${jobRef}/a/${next.id}`)}
          disabled={!next}
          className="btn btn-ghost btn-md flex-1 disabled:opacity-30"
          aria-label="Next asset"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------

function FieldRow({
  field,
  existing,
  onChange,
}: {
  field: ClassificationField
  existing?: ReturnType<typeof captureFor>
  onChange: (value: string | null, opts?: { flagged?: boolean; notes?: string | null }) => void
}) {
  const current = existing?.value ?? ''
  const [draft, setDraft] = useState(current)
  const [notesOpen, setNotesOpen] = useState(Boolean(existing?.notes))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const flagged = Boolean(existing?.flagged)

  // Keep draft synced with external changes (e.g. queue update)
  useEffect(() => {
    setDraft(existing?.value ?? '')
    setNotes(existing?.notes ?? '')
  }, [existing?.value, existing?.notes])

  const commit = (v: string) => {
    onChange(v === '' ? null : v, { notes: notes || null, flagged })
  }

  const toggleFlag = () => {
    onChange(existing?.value ?? null, { notes: notes || null, flagged: !flagged })
    // If flagging, open the notes area so the tech writes WHY
    if (!flagged) setNotesOpen(true)
  }

  const hasValue = Boolean(existing?.value && existing.value !== '')

  return (
    <div className={`p-4 ${flagged ? 'bg-warn/5 border-l-4 border-warn' : ''}`}>
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <label className="text-sm font-semibold text-ink block leading-tight">
            {field.display_name}
          </label>
          {field.sample_values ? (
            <div className="text-[11px] text-muted mt-0.5 truncate">e.g. {field.sample_values}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleFlag}
          className={`pill border whitespace-nowrap ${
            flagged
              ? 'bg-warn/20 text-warn border-warn/40'
              : 'bg-border/20 text-muted border-border hover:bg-warn/10 hover:text-warn hover:border-warn/30'
          }`}
          title={flagged ? 'Remove flag' : 'Flag for office review'}
        >
          {flagged ? '⚑ Flagged' : '⚐ Flag'}
        </button>
        <span
          className={`pill border whitespace-nowrap ${
            hasValue ? 'bg-ok/10 text-ok border-ok/20' : 'bg-border/40 text-muted border-border'
          }`}
        >
          {hasValue ? '✓' : field.data_type}
        </span>
      </div>

      <FieldInput field={field} value={draft} onChange={setDraft} onCommit={commit} />

      {/* Definition hint (collapsible) */}
      {field.definition ? (
        <details className="mt-2 text-[11px] text-muted">
          <summary className="cursor-pointer select-none hover:text-ink">What is this?</summary>
          <div className="mt-1 pl-3 border-l-2 border-border">{field.definition}</div>
        </details>
      ) : null}

      {/* Notes toggle */}
      <div className="mt-2 flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="text-muted hover:text-sky-deep"
        >
          {notesOpen ? '− Hide note' : '+ Add note'}
        </button>
      </div>
      {notesOpen ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onChange(existing?.value ?? null, { notes: notes || null, flagged })}
          placeholder={flagged
            ? 'Tell the office why this needs review (e.g. nameplate illegible, value doesn\'t match drawing)'
            : 'Notes for the office'}
          className="field-input mt-2 text-sm"
          rows={2}
        />
      ) : null}
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: ClassificationField
  value: string
  onChange: (v: string) => void
  onCommit: (v: string) => void
}) {
  if (field.data_type === 'LOV' && field.options.length > 0) {
    // Render as a compact grid of tap-target buttons for short option lists,
    // or a native select for long lists
    if (field.options.length <= 6) {
      return (
        <div className="grid grid-cols-2 gap-2">
          {field.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt)
                onCommit(opt)
              }}
              className={`py-3 px-3 rounded-xl border text-sm font-semibold text-left ${
                value === opt
                  ? 'border-sky bg-sky text-white'
                  : 'border-border bg-white text-ink hover:border-sky/60'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    }
    return (
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          onCommit(e.target.value)
        }}
        className="field-input appearance-none bg-white"
      >
        <option value="">Select…</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }
  if (field.data_type === 'NUM' || field.data_type === 'CURRENCY') {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
        placeholder={field.sample_values ?? '0'}
        className="field-input mono"
      />
    )
  }
  if (field.data_type === 'DATE') {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          onCommit(e.target.value)
        }}
        className="field-input"
      />
    )
  }
  // FREETEXT / fallback
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(value)}
      placeholder={field.sample_values ?? ''}
      className="field-input"
    />
  )
}

// ----------------------------------------------------------------------------
// Grouping heuristic
// ----------------------------------------------------------------------------

interface FieldGroup {
  title: string
  fields: ClassificationField[]
}

function groupFields(fields: ClassificationField[], classificationCode: string): FieldGroup[] {
  if (classificationCode === 'BREAKER') {
    // Dumb but effective: split into Nameplate / Trip Settings / Validation
    const nameplateKeys = [
      'amp frame', 'asset uid', 'breaker constr', 'breaker mount', 'breaker type',
      'ka rating', 'operator type', 'sensor in', 'trip model', 'trip type',
      'voltage rating',
    ]
    const tripKeys = [
      'ground fault', 'inst', 'long time', 'short time',
    ]
    const validationKeys = ['verified against']

    const nameplate: ClassificationField[] = []
    const trip: ClassificationField[] = []
    const validation: ClassificationField[] = []
    const other: ClassificationField[] = []

    for (const f of fields) {
      const n = f.display_name.toLowerCase()
      if (validationKeys.some((k) => n.includes(k))) validation.push(f)
      else if (tripKeys.some((k) => n.includes(k))) trip.push(f)
      else if (nameplateKeys.some((k) => n.includes(k))) nameplate.push(f)
      else other.push(f)
    }
    const groups: FieldGroup[] = []
    if (nameplate.length) groups.push({ title: '1 · Nameplate', fields: nameplate })
    if (trip.length) groups.push({ title: '2 · Trip settings', fields: trip })
    if (validation.length) groups.push({ title: '3 · Validation', fields: validation })
    if (other.length) groups.push({ title: 'Other', fields: other })
    return groups
  }
  // Default: group by field.group (Mechanical/Electrical/etc.) or everything in one bucket
  const byGroup = new Map<string, ClassificationField[]>()
  for (const f of fields) {
    const key = f.group ?? 'Fields'
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(f)
  }
  return Array.from(byGroup.entries()).map(([title, fs]) => ({ title, fields: fs }))
}

// ----------------------------------------------------------------------------
// CopyFromPrevious — big UX win for repetitive MSBs. When a tech lands on
// an un-captured asset, they can pull all captures from the prior asset
// (by row_number) in one tap. They see exactly what will copy before committing.

function CopyFromPrevious({
  jobId,
  capturedBy,
  currentAsset,
  assets,
  fieldCaptured,
}: {
  jobId: string
  capturedBy: string
  currentAsset: Asset
  assets: Asset[]
  fieldCaptured: ClassificationField[]
}) {
  const [dismissed, setDismissed] = useState(false)

  // Find the most recent PREVIOUS asset (by row_number) that actually has captures
  const prev = useMemo(() => {
    const sorted = [...assets].sort((a, b) => a.row_number - b.row_number)
    const idx = sorted.findIndex((a) => a.id === currentAsset.id)
    for (let i = idx - 1; i >= 0; i--) {
      const caps = capturesForAsset(sorted[i].id).filter((c) => c.value && c.value !== '')
      if (caps.length > 0) return { asset: sorted[i], captures: caps }
    }
    return null
  }, [assets, currentAsset.id])

  if (dismissed || !prev) return null

  const fieldById = new Map(fieldCaptured.map((f) => [f.id, f]))
  const copyable = prev.captures.filter((c) => fieldById.has(c.classificationFieldId))

  if (copyable.length === 0) return null

  const doCopy = () => {
    for (const c of copyable) {
      enqueueCapture({
        jobId,
        assetId: currentAsset.id,
        classificationFieldId: c.classificationFieldId,
        value: c.value,
        capturedBy,
        notes: null,
        flagged: false,
      })
    }
    setDismissed(true)
  }

  return (
    <div className="px-4 pt-3">
      <div className="card p-3 bg-sky-soft/50 border-sky/30">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky/20 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-deep">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-ink text-sm">
              Copy {copyable.length} fields from previous asset?
            </div>
            <div className="text-xs text-muted truncate mono">{prev.asset.description}</div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setDismissed(true)}
            className="btn btn-ghost btn-md flex-1"
          >
            No thanks
          </button>
          <button
            onClick={doCopy}
            className="btn btn-primary btn-md flex-1"
          >
            Copy values
          </button>
        </div>
        <div className="text-[10px] text-muted mt-2 text-center">
          You can still edit any field after copying. Flags and notes are not copied.
        </div>
      </div>
    </div>
  )
}
