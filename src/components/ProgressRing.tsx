interface Props {
  done: number
  total: number
  size?: number
}

export function ProgressRing({ done, total, size = 40 }: Props) {
  const pct = total === 0 ? 0 : Math.min(1, done / total)
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct)

  let colour = 'var(--sky)'
  if (pct === 1) colour = 'var(--ok)'
  else if (pct === 0) colour = 'var(--border)'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 200ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold mono">
        {done}/{total}
      </div>
    </div>
  )
}
