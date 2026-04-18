import { cn } from '../../lib/cn'

type Props = {
  children: React.ReactNode
  className?: string
  padding?: number | string
  onClick?: () => void
  hoverable?: boolean
  as?: 'div' | 'article' | 'section'
}

/**
 * Flat card — 1px border, no shadow. Shadows are reserved for
 * floating things (modals/popovers) per EQ Design Brief v1.3.
 */
export function Card({
  children,
  className,
  padding = 18,
  onClick,
  hoverable,
  as: Tag = 'div',
}: Props) {
  const style: React.CSSProperties =
    typeof padding === 'number' ? { padding } : { padding }
  return (
    <Tag
      onClick={onClick}
      style={style}
      className={cn(
        'bg-white rounded-xl border border-border transition-colors duration-150',
        hoverable && 'hover:border-sky-deep cursor-pointer',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
