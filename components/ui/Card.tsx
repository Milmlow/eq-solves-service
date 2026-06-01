import { cn } from '@/lib/utils/cn'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
}

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-lg p-4', className)} {...rest}>
      {children}
    </div>
  )
}
