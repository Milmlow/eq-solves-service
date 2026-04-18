import { cn } from '@/lib/utils/cn'
import { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-eq-sky text-white hover:bg-eq-deep': variant === 'primary',
          'bg-white text-eq-deep border border-eq-deep hover:bg-eq-ice': variant === 'secondary',
          'bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white': variant === 'danger',
          'h-8 px-3 text-xs': size === 'sm',
          'h-10 px-4 text-sm': size === 'md',
          'h-12 px-6 text-base': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
