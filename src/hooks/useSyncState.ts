import { useEffect, useState } from 'react'
import { pendingCount, subscribeQueue, syncPending } from '../lib/queue'

/**
 * Observable view of network + sync queue. Drives the TopBar pill.
 */
export function useSyncState() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [pending, setPending] = useState<number>(() => pendingCount())
  const [syncing, setSyncing] = useState<boolean>(false)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const unsub = subscribeQueue(() => setPending(pendingCount()))
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      unsub()
    }
  }, [])

  const sync = async () => {
    if (!navigator.onLine) return
    setSyncing(true)
    try {
      await syncPending()
    } finally {
      setSyncing(false)
      setPending(pendingCount())
    }
  }

  return { online, pending, syncing, sync }
}
