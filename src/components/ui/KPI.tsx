import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Card } from './Card'

type Props = {
  label: string
  value: string | number
  icon?: LucideIcon
  tone?: 'neutral' | 'info' | 'warn' | 'bad' | 'ok'
  footer?: React.ReactNode
  className?: string
}

const toneCls: Record<NonNullable<Props['tone']>, { tint: string; fg: string }> = {
  neutral: { tint: 'bg-gray-50',         fg: 'text-ink'          },
  info:    { tint: 'bg-[#EAF5FB]',       fg: 'text-[#2986B4]'    },
  warn:    { tint: 'bg-[#FFFBEB]',       fg: 'text-[#B45309]'    },
  bad:     { tint: 'bg-[#FEF2F2]',       fg: 'text-[#B91C1C]'    },
  ok:      { tint: 'bg-[#F0FDF4]',       fg: 'text-[#15803D]'    },
}

/**
 * Dashboard KPI tile. Big number + label + optional icon/footer.
 */
export function KPI({ label, value, icon: Icon, tone = 'neutral', footer, className }: Props) {
  const t = toneCls[tone]
  return (
    <Card padding={0} className={cn('flex flex-col', className)}>
      <div className="flex items-start justify-between p-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
            {label}
          </div>
          <div
            className={cn(
              'mt-1.5 font-mono font-bold text-[28px] leading-none tabular-nums',
              t.fg,
            )}
            style={{ letterSpacing: '-0.02em' }}
          >
            {value}
          </div>
        </div>
        {Icon && (
          <div
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md shrink-0',
              t.tint,
            )}
          >
            <Icon size={16} strokeWidth={2} className={t.fg} />
          </div>
        )}
      </div>
      {footer && (
        <div className="px-4 pb-3 pt-1 text-[12px] text-muted border-t border-gray-100">
          {footer}
        </div>
      )}
    </Card>
  )
}

/**
 * Compact KPI — used in Self-check grid (4-across).
 */
export function KpiSmall({
  label,
  value,
  tone = 'neutral',
  className,
}: Pick<Props, 'label' | 'value' | 'tone' | 'className'>) {
  const t = toneCls[tone]
  return (
    <div
      className={cn(
        'rounded-lg border border-border p-3 flex flex-col gap-1',
        t.tint,
        className,
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">{label}</div>
      <div className={cn('font-mono font-bold text-[20px] leading-none tabular-nums', t.fg)}>
        {value}
      </div>
    </div>
  )
}
