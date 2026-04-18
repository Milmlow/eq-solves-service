import { forwardRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

type Props = {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  type?: 'text' | 'number' | 'email' | 'tel' | 'password' | 'search'
  icon?: LucideIcon
  mono?: boolean
  disabled?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  autoFocus?: boolean
  className?: string
  inputClassName?: string
  id?: string
  'aria-label'?: string
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {
    value,
    onChange,
    placeholder,
    type = 'text',
    icon: Icon,
    mono,
    disabled,
    onKeyDown,
    inputMode,
    maxLength,
    autoFocus,
    className,
    inputClassName,
    id,
    ...rest
  },
  ref,
) {
  const [focus, setFocus] = useState(false)
  return (
    <div className={cn('relative flex items-center', className)}>
      {Icon && (
        <div className="absolute left-3 text-gray-400 pointer-events-none">
          <Icon size={14} strokeWidth={2} />
        </div>
      )}
      <input
        ref={ref}
        id={id}
        type={type}
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        inputMode={inputMode}
        maxLength={maxLength}
        autoFocus={autoFocus}
        className={cn(
          'w-full rounded-md border bg-white text-ink outline-none',
          'text-[14px] font-sans',
          'py-[9px]',
          Icon ? 'pl-[34px] pr-3' : 'px-3',
          mono && 'font-mono',
          focus ? 'border-sky-deep shadow-focus' : 'border-gray-300',
          disabled && 'bg-gray-50 cursor-not-allowed',
          'transition-shadow duration-120',
          inputClassName,
        )}
        {...rest}
      />
    </div>
  )
})
