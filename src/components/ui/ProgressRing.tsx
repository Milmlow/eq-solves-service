import { cn } from '../../lib/cn'

type Props = {
  done: number
  total: number
  size?: number
  stroke?: number
  showLabel?: boolean
  className?: string
}

export function ProgressRing({
  done,
  total,
  size = 44,
  stroke = 4,
  showLabel = true,
  className,
}: Props) {
  const pct = total > 0 ? done / total : 0
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const complete = total > 0 && done >= total
  const color = complete ? '#16A34A' : pct > 0 ? '#3DA8D8' : '#D1D5DB'
  const labelSize = size >= 56 ? 13 : 10

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={done}
      aria-valuemax={total}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#F3F4F6" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 300ms ease' }}
        />
      </svg>
      {showLabel && (
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center font-mono font-bold',
            complete ? 'text-[#15803D]' : 'text-ink',
          )}
          style={{ fontSize: labelSize, letterSpacing: '-0.02em', lineHeight: 1 }}
        >
          {complete ? '✓' : `${done}/${total}`}
        </div>
      )}
    </div>
  )
}
