import { useEffect, useState } from 'react'
import { User } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'

type Props = {
  open: boolean
  initialValue?: string | null
  onSubmit: (name: string) => void
  onClose: () => void
  /** Set false to hide the close button (required on first run). */
  dismissable?: boolean
}

/**
 * Prompt for capturer name. 400px centered card on backdrop.
 * Every capture is stamped with this value, so it must be set
 * before the app becomes useful.
 */
export function NameModal({
  open,
  initialValue,
  onSubmit,
  onClose,
  dismissable = true,
}: Props) {
  const [name, setName] = useState(initialValue || '')

  useEffect(() => {
    if (open) setName(initialValue || '')
  }, [open, initialValue])

  useEffect(() => {
    if (!open || !dismissable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismissable, onClose])

  if (!open) return null

  const canSubmit = name.trim().length >= 2

  const submit = () => {
    if (canSubmit) onSubmit(name.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/30 backdrop-blur-sm">
      <div
        className="w-full max-w-[400px] bg-white rounded-xl shadow-lg p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-modal-title"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-ice text-sky-deep">
            <User size={20} strokeWidth={2} />
          </div>
          <div>
            <div id="name-modal-title" className="text-[17px] font-bold text-ink leading-tight">
              Who's capturing?
            </div>
            <div className="text-[12px] text-muted">
              Your name is stamped onto every capture for audit.
            </div>
          </div>
        </div>

        <Label htmlFor="capturer-name" className="mb-1.5">
          Full name
        </Label>
        <Input
          id="capturer-name"
          value={name}
          onChange={setName}
          placeholder="e.g. Royce Milmlow"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter') submit()
          }}
        />
        {name.length > 0 && !canSubmit && (
          <div className="mt-1.5 text-[11px] text-bad">
            Use at least 2 characters.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          {dismissable && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button onClick={submit} disabled={!canSubmit}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
