/**
 * Relative time — "3 min ago", "2 h ago", "yesterday", or falls back to
 * a short date for anything older than a week.
 */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const secs = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} d ago`
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export function formatPct(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}
