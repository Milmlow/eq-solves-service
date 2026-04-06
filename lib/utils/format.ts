import type { Frequency, CheckStatus, CheckItemResult, TestResult, AcbTestType, AcbTestResult, NsxTestType, NsxTestResult } from '@/lib/types'

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

const testResultLabels: Record<TestResult, string> = {
  pending: 'Pending',
  pass: 'Pass',
  fail: 'Fail',
  defect: 'Defect',
}

export function formatTestResult(result: TestResult): string {
  return testResultLabels[result] ?? result
}

const acbTestTypeLabels: Record<AcbTestType, string> = {
  Initial: 'Initial',
  Routine: 'Routine',
  Special: 'Special',
}

export function formatAcbTestType(type: AcbTestType): string {
  return acbTestTypeLabels[type] ?? type
}

const acbTestResultLabels: Record<AcbTestResult, string> = {
  Pending: 'Pending',
  Pass: 'Pass',
  Fail: 'Fail',
  Defect: 'Defect',
}

export function formatAcbTestResult(result: AcbTestResult): string {
  return acbTestResultLabels[result] ?? result
}

const nsxTestTypeLabels: Record<NsxTestType, string> = {
  Initial: 'Initial',
  Routine: 'Routine',
  Special: 'Special',
}

export function formatNsxTestType(type: NsxTestType): string {
  return nsxTestTypeLabels[type] ?? type
}

const nsxTestResultLabels: Record<NsxTestResult, string> = {
  Pending: 'Pending',
  Pass: 'Pass',
  Fail: 'Fail',
  Defect: 'Defect',
}

export function formatNsxTestResult(result: NsxTestResult): string {
  return nsxTestResultLabels[result] ?? result
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
