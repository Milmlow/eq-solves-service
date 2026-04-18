import { cn } from '../../lib/cn'

type Props = {
  label: string
  children: React.ReactNode
  mono?: boolean
  className?: string
}

/**
 * Two-column key:value row used in detail panels (site info,
 * asset metadata, export summary).
 */
export function MetaRow({ label, children, mono, className }: Props) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-1.5', className)}>
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted shrink-0">
        {label}
      </div>
      <div
        className={cn(
          'text-[13px] text-ink text-right min-w-0 break-words',
          mono && 'font-mono text-[12px]',
        )}
      >
        {children}
      </div>
    </div>
  )
}
