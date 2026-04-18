import { cn } from '../../lib/cn'

type Props = {
  children: React.ReactNode
  className?: string
  color?: 'deep' | 'muted' | 'white'
}

const colorCls: Record<NonNullable<Props['color']>, string> = {
  deep:  'text-sky-deep',
  muted: 'text-muted',
  white: 'text-white',
}

/**
 * 10px / 700 / 0.2em tracking — used above big headlines.
 */
export function Eyebrow({ children, className, color = 'deep' }: Props) {
  return (
    <div
      className={cn(
        'text-[10px] font-bold uppercase tracking-[0.2em]',
        colorCls[color],
        className,
      )}
    >
      {children}
    </div>
  )
}
