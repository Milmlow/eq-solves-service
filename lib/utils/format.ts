import type { Frequency, CheckStatus, CheckItemResult } from '@/lib/types'

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

const checkStatusLabels: Record<CheckStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  complete: 'Complete',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

export function formatCheckStatus(status: CheckStatus): string {
  return checkStatusLabels[status] ?? status
}

const checkItemResultLabels: Record<CheckItemResult, string> = {
  pass: 'Pass',
  fail: 'Fail',
  na: 'N/A',
}

export function formatCheckItemResult(result: CheckItemResult): string {
  return checkItemResultLabels[result] ?? result
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
