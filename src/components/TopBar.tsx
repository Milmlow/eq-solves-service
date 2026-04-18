import { useEffect, useState } from 'react'
import { pendingCount, subscribeQueue, syncPending, allCaptures } from '../lib/queue'
import { EqMark } from './EqMark'
import { OverflowMenu } from './OverflowMenu'

interface Props {
  title: string
  subtitle?: string
  onBack?: () => void
  right?: React.ReactNode
  /** Pass false to hide the 3-dot menu (e.g. on root pages). Default true. */
  showMenu?: boolean
  /** Show "Change name" in the overflow menu — only makes sense in capture flow. */
  showChangeName?: boolean
  /** Called when user taps "Change name" in the menu. */
  onChangeName?: () => void
}

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
  showMenu = true,
  showChangeName,
  onChangeName,
}: Props) {
  const [pending, setPending] = useState(pendingCount())
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => {
      setPending(pendingCount())
      // Find any pending capture with a lastError
      const err = allCaptures().find((c) => !c.synced && c.lastError)?.lastError
      setLastError(err ?? null)
    }
    refresh()
    return subscribeQueue(refresh)
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const handleSync = async () => {
    if (lastError) {
      alert(`Sync error:\n\n${lastError}\n\nTap sync again to retry. If this keeps happening, check with the office.`)
      setLastError(null)
    }
    setSyncing(true)
    try {
      await syncPending()
    } finally {
      setSyncing(false)
    }
  }

  let statusLabel = 'SYNCED'
  let statusClass = 'bg-ok/10 text-ok border-ok/20'
  if (!online) {
    statusLabel = 'OFFLINE'
    statusClass = 'bg-warn/15 text-warn border-warn/30'
  } else if (lastError) {
    statusLabel = `${pending} ERROR`
    statusClass = 'bg-bad/10 text-bad border-bad/30'
  } else if (pending > 0) {
    statusLabel = `${pending} PENDING`
    statusClass = 'bg-warn/15 text-warn border-warn/30'
  }

  return (
    <div className="safe-top sticky top-0 z-20 bg-paper/95 backdrop-blur border-b border-border">
      <div className="flex items-center gap-3 px-4 h-14">
        {onBack ? (
          <button
            onClick={onBack}
            className="-ml-2 p-2 rounded-lg hover:bg-sky-soft active:bg-border"
            aria-label="Back"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        ) : (
          <div className="-ml-1" aria-hidden>
            <EqMark size={24} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-ink truncate leading-tight">{title}</div>
          {subtitle ? <div className="text-xs text-muted truncate">{subtitle}</div> : null}
        </div>
        <button
          onClick={handleSync}
          disabled={!online || syncing || (pending === 0 && !lastError)}
          className={`pill border ${statusClass} ${
            online && (pending > 0 || lastError) && !syncing ? 'cursor-pointer' : 'cursor-default'
          }`}
          title={
            lastError
              ? 'Sync failed — tap to see error'
              : online
                ? 'Tap to sync'
                : 'Offline — will sync when connection returns'
          }
        >
          {syncing ? 'SYNCING…' : statusLabel}
        </button>
        {right}
        {showMenu ? (
          <OverflowMenu
            showChangeName={showChangeName}
            onChangeName={onChangeName}
          />
        ) : null}
      </div>
    </div>
  )
}
