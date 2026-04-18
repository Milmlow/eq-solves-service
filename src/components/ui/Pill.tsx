import { cn } from '../../lib/cn'

export type PillTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

type Props = {
  tone?: PillTone
  size?: 'sm' | 'md'
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const tones: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  ok:      { bg: 'bg-[#F0FDF4]', fg: 'text-[#15803D]', dot: 'bg-[#16A34A]' },
  warn:    { bg: 'bg-[#FFFBEB]', fg: 'text-[#B45309]', dot: 'bg-[#D97706]' },
  bad:     { bg: 'bg-[#FEF2F2]', fg: 'text-[#B91C1C]', dot: 'bg-[#DC2626]' },
  info:    { bg: 'bg-[#EAF5FB]', fg: 'text-[#2986B4]', dot: 'bg-[#3DA8D8]' },
  neutral: { bg: 'bg-gray-100',  fg: 'text-gray-600',  dot: 'bg-gray-400'  },
}

export function Pill({ tone = 'neutral', size = 'md', children, className, dot = true }: Props) {
  const t = tones[tone]
  const sm = size === 'sm'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-bold uppercase whitespace-nowrap',
        sm ? 'px-2 py-[2px] text-[10px]' : 'px-2.5 py-[3px] text-[11px]',
        'tracking-[0.05em] leading-[1.4]',
        t.bg,
        t.fg,
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            'rounded-full shrink-0',
            sm ? 'w-[5px] h-[5px]' : 'w-[6px] h-[6px]',
            t.dot,
          )}
        />
      )}
      {children}
    </span>
  )
}
