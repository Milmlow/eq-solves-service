import { Bell, Check, Clock, RefreshCw, Search, WifiOff } from 'lucide-react'
import { cn } from '../../lib/cn'

type Props = {
  title: string
  subtitle?: string
  breadcrumb?: React.ReactNode
  online: boolean
  pending: number
  syncing: boolean
  onSync: () => void
  captureBy: string | null
  onChangeName: () => void
  onOpenSearch?: () => void
}

type StatusTone = 'ok' | 'warn' | 'info'

export function TopBar({
  title,
  subtitle,
  breadcrumb,
  online,
  pending,
  syncing,
  onSync,
  captureBy,
  onChangeName,
  onOpenSearch,
}: Props) {
  let tone: StatusTone = 'ok'
  let label = 'Synced'
  let Icon = Check

  if (!online) {
    tone = 'warn'
    label = 'Offline'
    Icon = WifiOff
  } else if (syncing) {
    tone = 'info'
    label = 'Syncing…'
    Icon = RefreshCw
  } else if (pending > 0) {
    tone = 'warn'
    label = `${pending} pending`
    Icon = Clock
  }

  const toneCls: Record<StatusTone, string> = {
    ok:   'bg-[#F0FDF4] text-[#15803D] border-[#bbf7d0]',
    warn: 'bg-[#FFFBEB] text-[#B45309] border-[#fde68a]',
    info: 'bg-[#EAF5FB] text-[#2986B4] border-[#bae6fd]',
  }

  const initials = captureBy
    ? captureBy.split(/\s+/).map(n => n[0] || '').join('').slice(0, 2).toUpperCase()
    : 'AU'

  return (
    <header className="flex items-center justify-between gap-4 shrink-0 h-14 px-6 bg-white border-b border-border">
      <div className="flex-1 min-w-0">
        {breadcrumb && (
          <div className="flex items-center gap-1 text-[11px] text-muted mb-0.5">
            {breadcrumb}
          </div>
        )}
        <div className="flex items-baseline gap-2.5 min-w-0">
          <div className="text-[17px] font-bold text-ink tracking-tight truncate">
            {title}
          </div>
          {subtitle && (
            <div className="text-[12px] text-muted whitespace-nowrap">{subtitle}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Sync pill */}
        <button
          onClick={onSync}
          title="Sync now"
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border',
            'text-[11px] font-bold uppercase tracking-[0.05em] cursor-pointer',
            'transition-colors duration-150',
            toneCls[tone],
            syncing && 'cursor-wait',
          )}
        >
          <Icon size={12} strokeWidth={2} className={syncing ? 'animate-spin' : ''} />
          {label}
        </button>

        {/* Search */}
        <button
          type="button"
          onClick={onOpenSearch}
          className={cn(
            'relative flex items-center h-8 w-[220px] px-3 rounded-md',
            'bg-gray-50 border border-border text-[12px] text-muted',
            'hover:border-gray-300 transition-colors duration-150 cursor-pointer',
          )}
        >
          <Search size={14} strokeWidth={2} className="text-gray-400 mr-2" />
          <span className="truncate text-left">Search assets, jobs…</span>
        </button>

        {/* Notifications */}
        <button
          title="Notifications"
          className={cn(
            'relative inline-flex items-center justify-center h-8 w-8 rounded-md',
            'bg-white border border-border text-gray-600 hover:border-gray-300',
            'transition-colors duration-150 cursor-pointer',
          )}
        >
          <Bell size={14} strokeWidth={2} />
          <span className="absolute top-1.5 right-[7px] w-[7px] h-[7px] rounded-full bg-warn border-[1.5px] border-white" />
        </button>

        {/* Capturer avatar */}
        <button
          onClick={onChangeName}
          title="Change capturer name"
          className={cn(
            'inline-flex items-center gap-2 pl-0.5 pr-2.5 py-0.5 rounded-full',
            'bg-white border border-border hover:border-gray-300',
            'transition-colors duration-150 cursor-pointer',
          )}
        >
          <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full bg-sky text-white text-[11px] font-bold">
            {initials}
          </span>
          <span className="text-[12px] font-semibold text-ink leading-none">
            {captureBy || 'Set name'}
          </span>
        </button>
      </div>
    </header>
  )
}
