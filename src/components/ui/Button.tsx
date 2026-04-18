import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'primary' | 'ghost' | 'ink' | 'danger' | 'subtle'
export type ButtonSize = 'sm' | 'md' | 'lg'

type Props = {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  type?: 'button' | 'submit' | 'reset'
  title?: string
  className?: string
  fullWidth?: boolean
  'aria-label'?: string
}

const sizeCls: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[10px] text-[12px]',
  md: 'h-[36px] px-[14px] text-[13px]',
  lg: 'h-[42px] px-[18px] text-[14px]',
}

const iconSize: Record<ButtonSize, number> = { sm: 14, md: 14, lg: 16 }

const variantCls: Record<ButtonVariant, string> = {
  primary: 'bg-sky text-white border-transparent hover:bg-sky-deep disabled:hover:bg-sky',
  ghost:   'bg-white text-ink border-border hover:border-sky-deep',
  ink:     'bg-ink text-white border-transparent hover:bg-[#2a2a44]',
  danger:  'bg-bad text-white border-transparent hover:bg-[#991B1B]',
  subtle:  'bg-transparent text-sky-deep border-transparent hover:bg-ice',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    children,
    onClick,
    disabled,
    icon: Icon,
    iconRight: IconRight,
    type = 'button',
    title,
    className,
    fullWidth,
    ...rest
  },
  ref,
) {
  const isIconOnly = !children && !!(Icon || IconRight)
  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1.5',
        'rounded-md border font-semibold whitespace-nowrap',
        'transition-colors duration-150 font-sans',
        'focus:outline-none focus-visible:shadow-focus',
        sizeCls[size],
        variantCls[variant],
        disabled && 'opacity-45 cursor-not-allowed',
        !disabled && 'cursor-pointer',
        fullWidth && 'w-full',
        isIconOnly && 'aspect-square px-0',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={iconSize[size]} strokeWidth={2} />}
      {children}
      {IconRight && <IconRight size={iconSize[size]} strokeWidth={2} />}
    </button>
  )
})
