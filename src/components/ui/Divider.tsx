import { cn } from '../../lib/cn'

type Props = {
  vertical?: boolean
  className?: string
}

export function Divider({ vertical, className }: Props) {
  return (
    <div
      className={cn(
        'bg-gray-200',
        vertical ? 'w-px self-stretch' : 'w-full h-px',
        className,
      )}
    />
  )
}
