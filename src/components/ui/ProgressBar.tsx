import { cn } from '../../lib/cn'

type Props = {
  done: number
  total: number
  color?: string          // CSS colour; defaults to EQ Sky
  height?: number
  className?: string
}

export function ProgressBar({ done, total, color = '#3DA8D8', height = 6, className }: Props) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0
  return (
    <div
      className={cn('w-full rounded-full overflow-hidden bg-gray-100', className)}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}
