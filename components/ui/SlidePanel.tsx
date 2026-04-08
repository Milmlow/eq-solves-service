'use client'
import { cn } from '@/lib/utils/cn'
import { X } from 'lucide-react'
import { useEffect } from 'react'

interface SlidePanelProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  wide?: boolean
}

export function SlidePanel({ open, onClose, title, children, className, wide }: SlidePanelProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      )}
    >
      <div
        className="absolute inset-0 bg-eq-ink/40"
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 h-full w-full bg-white shadow-xl transition-transform duration-200 flex flex-col',
          wide ? 'max-w-4xl' : 'max-w-md',
          open ? 'translate-x-0' : 'translate-x-full',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-eq-ink">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-eq-grey" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  )
}
