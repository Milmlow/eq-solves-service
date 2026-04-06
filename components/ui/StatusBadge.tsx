import { cn } from '@/lib/utils/cn'

type Status = 'not-started' | 'in-progress' | 'complete' | 'blocked' | 'overdue' | 'active' | 'inactive'

const statusConfig: Record<Status, { label: string; className: string }> = {
  'not-started': { label: 'Not Started', className: 'bg-gray-100 text-gray-600' },
  'in-progress': { label: 'In Progress', className: 'bg-eq-ice text-eq-deep' },
  'complete':    { label: 'Complete',    className: 'bg-green-50 text-green-700' },
  'blocked':     { label: 'Blocked',     className: 'bg-red-50 text-red-600' },
  'overdue':     { label: 'Overdue',     className: 'bg-amber-50 text-amber-700' },
  'active':      { label: 'Active',      className: 'bg-green-50 text-green-700' },
  'inactive':    { label: 'Inactive',    className: 'bg-gray-100 text-gray-500' },
}

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const config = statusConfig[status]
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide',
      config.className
    )}>
      {label ?? config.label}
    </span>
  )
}
