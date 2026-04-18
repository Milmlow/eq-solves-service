import { cn } from '../../lib/cn'

type Props = {
  children: React.ReactNode
  className?: string
  htmlFor?: string
}

/**
 * Uppercase label — 11px / 700 / 0.06em tracking / muted grey.
 * Use for form group labels, section captions.
 */
export function Label({ children, className, htmlFor }: Props) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'block text-[11px] font-bold uppercase tracking-[0.06em] text-muted',
        className,
      )}
    >
      {children}
    </label>
  )
}
