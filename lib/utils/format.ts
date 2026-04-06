import type { Frequency } from '@/lib/types'

const frequencyLabels: Record<Frequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Bi-annual',
  annual: 'Annual',
  ad_hoc: 'Ad Hoc',
}

export function formatFrequency(freq: Frequency): string {
  return frequencyLabels[freq] ?? freq
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
