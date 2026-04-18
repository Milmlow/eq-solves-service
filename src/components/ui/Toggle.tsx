import { cn } from '../../lib/cn'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  description?: string
  id?: string
  className?: string
}

/**
 * Accessible toggle switch. Use inside Export "package contents" rows
 * and Debug feature flags.
 */
export function Toggle({ checked, onChange, disabled, label, description, id, className }: Props) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={id}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative h-[22px] w-[38px] rounded-full transition-colors duration-150 shrink-0',
          'focus:outline-none focus-visible:shadow-focus',
          checked ? 'bg-sky' : 'bg-gray-300',
        )}
      >
        <span
          className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-xs transition-transform duration-150"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </button>
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && <div className="text-[13px] font-semibold text-ink">{label}</div>}
          {description && <div className="text-[12px] text-muted">{description}</div>}
        </div>
      )}
    </label>
  )
}
