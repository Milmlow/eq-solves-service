'use client'
import { cn } from '@/lib/utils/cn'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

/**
 * Modal — A1 (quality-polish-backlog).
 *
 * Upgraded to match ConfirmDialog.tsx's accessibility pattern:
 *   - role="dialog" + aria-modal="true" on the dialog element
 *   - aria-labelledby wired to the title when present
 *   - Focus trap: Tab/Shift+Tab cycle inside; Escape closes
 *   - Focus restore: returns to the element that had focus before open
 *   - Scroll lock on body while open
 *   - Rendered via createPortal so it sits at the document root
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

  // Focus management: capture previous focus, move focus into the dialog
  // on open, restore on close.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement
    // Defer focus to next paint so dialog content is mounted.
    const id = requestAnimationFrame(() => {
      const el = dialogRef.current
      if (!el) return
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length > 0) {
        focusable[0].focus()
      } else {
        el.focus()
      }
    })
    return () => {
      cancelAnimationFrame(id)
      const prev = previouslyFocused.current as HTMLElement | null
      if (prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [open])

  // Keyboard handling: Escape closes; Tab stays inside.
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Scroll lock while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  const titleId = title ? 'modal-dialog-title' : undefined

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-eq-ink/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto focus:outline-none',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 id={titleId} className="text-lg font-bold text-eq-ink">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-eq-grey" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}
