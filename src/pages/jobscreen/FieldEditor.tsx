import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Flag } from 'lucide-react'
import type { ClassificationField } from '../../types/db'
import type { QueuedCapture } from '../../lib/queue'
import { cn } from '../../lib/cn'

type Props = {
  field: ClassificationField
  existing?: QueuedCapture
  onChange: (value: string | null, opts?: { flagged?: boolean; notes?: string | null }) => void
  /** Compact two-column layout (JobScreen right pane) — default true. */
  compact?: boolean
  /** Ref forwarded to the primary input/select so parent can focus the first empty field. */
  inputRef?: React.RefObject<HTMLElement | null>
}

export function FieldEditor({ field, existing, onChange, compact = true, inputRef }: Props) {
  const current = existing?.value ?? ''
  const [draft, setDraft] = useState(current)
  const [notesOpen, setNotesOpen] = useState(Boolean(existing?.notes))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)
  const flagged = Boolean(existing?.flagged)

  useEffect(() => {
    setDraft(existing?.value ?? '')
    setNotes(existing?.notes ?? '')
  }, [existing?.value, existing?.notes])

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  const triggerFlash = () => {
    setFlash(true)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(false), 900)
  }

  const commit = (v: string) => {
    const prev = existing?.value ?? ''
    if (v !== prev) triggerFlash()
    onChange(v === '' ? null : v, { notes: notes || null, flagged })
  }

  const toggleFlag = () => {
    onChange(existing?.value ?? null, { notes: notes || null, flagged: !flagged })
    if (!flagged) setNotesOpen(true)
  }

  const hasValue = Boolean(existing?.value && existing.value !== '')

  return (
    <div
      className={cn(
        'rounded-md transition-shadow duration-300',
        flagged && 'pl-2.5 -ml-2.5 border-l-2 border-warn',
        flash && 'ring-2 ring-ok/60 ring-offset-2 ring-offset-white',
      )}
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <label
            className={cn(
              'text-[11px] font-bold uppercase tracking-[0.06em] leading-none',
              hasValue ? 'text-muted' : 'text-ink',
            )}
          >
            {field.display_name}
          </label>
          {hasValue && <Check size={11} strokeWidth={2.5} className="text-ok shrink-0" />}
        </div>
        <button
          type="button"
          onClick={toggleFlag}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-[0.04em]',
            'transition-colors duration-120 cursor-pointer',
            flagged
              ? 'bg-bad-bg text-bad-fg border-bad/40'
              : 'bg-transparent text-muted border-border hover:text-warn hover:border-warn/40',
          )}
          title={flagged ? 'Remove flag' : 'Flag for review'}
        >
          <Flag size={10} strokeWidth={2.5} />
          {flagged ? 'Flagged' : 'Flag'}
        </button>
      </div>

      <FieldControl
        field={field}
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        compact={compact}
        inputRef={inputRef}
      />

      {field.sample_values && !hasValue && (
        <div className="mt-1 text-[10px] text-muted truncate">e.g. {field.sample_values}</div>
      )}

      {(notesOpen || notes) && (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => onChange(existing?.value ?? null, { notes: notes || null, flagged })}
          rows={2}
          placeholder={
            flagged
              ? "Why does this need review? (e.g. nameplate illegible)"
              : 'Notes for the office'
          }
          className={cn(
            'mt-2 w-full px-3 py-2 rounded-md border border-gray-300',
            'text-[12px] font-sans outline-none resize-y',
            'focus:border-sky-deep focus:shadow-focus',
          )}
        />
      )}
      {!notesOpen && !notes && (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          className="mt-1 text-[11px] text-muted hover:text-sky-deep cursor-pointer"
        >
          + Add note
        </button>
      )}
    </div>
  )
}

function FieldControl({
  field,
  value,
  onChange,
  onCommit,
  compact,
  inputRef,
}: {
  field: ClassificationField
  value: string
  onChange: (v: string) => void
  onCommit: (v: string) => void
  compact: boolean
  inputRef?: React.RefObject<HTMLElement | null>
}) {
  if (field.data_type === 'LOV' && field.options.length > 0) {
    // Short list → tap grid (but one row in compact mode)
    if (field.options.length <= 4 && !compact) {
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {field.options.map((opt, i) => (
            <button
              key={opt}
              type="button"
              ref={
                i === 0
                  ? (el) => {
                      if (inputRef) (inputRef as React.MutableRefObject<HTMLElement | null>).current = el
                    }
                  : undefined
              }
              onClick={() => {
                onChange(opt)
                onCommit(opt)
              }}
              className={cn(
                'px-3 py-2 rounded-md border text-[13px] font-semibold text-left',
                'transition-colors duration-120 cursor-pointer',
                value === opt
                  ? 'border-sky bg-sky text-white'
                  : 'border-gray-300 bg-white text-ink hover:border-sky-deep',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    }
    return (
      <div className="relative">
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement> | undefined}
          value={value}
          onChange={e => {
            onChange(e.target.value)
            onCommit(e.target.value)
          }}
          className={cn(
            'w-full pl-3 pr-8 py-[9px] rounded-md border border-gray-300 bg-white',
            'text-[13px] font-sans outline-none appearance-none cursor-pointer',
            'focus:border-sky-deep focus:shadow-focus',
            value ? 'text-ink' : 'text-gray-400',
          )}
        >
          <option value="">Select…</option>
          {field.options.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>
    )
  }

  if (field.data_type === 'NUM' || field.data_type === 'CURRENCY') {
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement> | undefined}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
        placeholder={field.sample_values ?? '0'}
        className={cn(
          'w-full px-3 py-[9px] rounded-md border border-gray-300',
          'text-[13px] font-mono outline-none bg-white',
          'focus:border-sky-deep focus:shadow-focus',
        )}
      />
    )
  }

  if (field.data_type === 'DATE') {
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement> | undefined}
        type="date"
        value={value}
        onChange={e => {
          onChange(e.target.value)
          onCommit(e.target.value)
        }}
        className={cn(
          'w-full px-3 py-[9px] rounded-md border border-gray-300',
          'text-[13px] outline-none bg-white font-sans',
          'focus:border-sky-deep focus:shadow-focus',
        )}
      />
    )
  }

  // FREETEXT / fallback
  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement> | undefined}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={() => onCommit(value)}
      placeholder={field.sample_values ?? ''}
      className={cn(
        'w-full px-3 py-[9px] rounded-md border border-gray-300',
        'text-[13px] font-sans outline-none bg-white',
        'focus:border-sky-deep focus:shadow-focus',
      )}
    />
  )
}
