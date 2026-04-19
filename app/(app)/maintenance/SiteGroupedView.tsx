'use client'

import { useMemo, useState, useTransition } from 'react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils/format'
import {
  ChevronDown,
  ChevronRight,
  MapPin,
  Eye,
  Trash2,
  AlertTriangle,
  Moon,
  CalendarClock,
  FileText,
  User,
  Factory,
} from 'lucide-react'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckStatus, Site } from '@/lib/types'
import { archiveCheckAction } from './actions'

type CheckRow = MaintenanceCheck & {
  job_plans?: { name: string } | null
  sites?: { name: string } | null
  assignee_name?: string | null
  item_count?: number
  completed_count?: number
} & Record<string, unknown>

type SiteInfo = Pick<Site, 'id' | 'name' | 'customer_id'> & {
  code?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

interface SiteGroupedViewProps {
  checks: CheckRow[]
  itemsMap: Record<string, MaintenanceCheckItem[]>
  sites: SiteInfo[]
  onCheckClick: (check: CheckRow) => void
  isAdmin?: boolean
}

function statusToBadge(status: CheckStatus) {
  const map: Record<CheckStatus, 'not-started' | 'in-progress' | 'complete' | 'cancelled' | 'overdue'> = {
    scheduled: 'not-started',
    in_progress: 'in-progress',
    complete: 'complete',
    cancelled: 'cancelled',
    overdue: 'overdue',
  }
  return map[status]
}

function formatFrequency(f: string | null | undefined): string {
  if (!f) return ''
  return f.replace('_', '-').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Card title on the site-grouped kanban: the site is already the card header,
// and the job plan is shown as its own tag below — so the headline should be
// the time-discriminator (month + year of due date). Falls back to custom_name
// when there's no due date.
function formatCheckTitle(dueIso: string | null | undefined, customName: string | null | undefined): string {
  if (dueIso) {
    const d = new Date(dueIso + 'T00:00:00Z')
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    }
  }
  return customName ?? '—'
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z').getTime()
  const b = new Date(bIso + 'T00:00:00Z').getTime()
  return Math.round((a - b) / (1000 * 60 * 60 * 24))
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Kanban columns mirror the global kanban order: Scheduled, In Progress, Overdue, Complete
type KanbanCol = 'scheduled' | 'in_progress' | 'overdue' | 'complete'
const KANBAN_COLS: KanbanCol[] = ['scheduled', 'in_progress', 'overdue', 'complete']
const KANBAN_LABEL: Record<KanbanCol, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  overdue: 'Overdue',
  complete: 'Complete',
}
const KANBAN_HEADER_TEXT: Record<KanbanCol, string> = {
  scheduled: 'text-gray-600',
  in_progress: 'text-eq-deep',
  overdue: 'text-red-600',
  complete: 'text-green-700',
}
const KANBAN_HEADER_BG: Record<KanbanCol, string> = {
  scheduled: 'bg-gray-50',
  in_progress: 'bg-eq-ice',
  overdue: 'bg-red-50',
  complete: 'bg-green-50',
}
const KANBAN_DOT: Record<KanbanCol, string> = {
  scheduled: 'bg-gray-400',
  in_progress: 'bg-eq-sky',
  overdue: 'bg-red-500',
  complete: 'bg-green-500',
}

interface SiteGroup {
  siteId: string
  siteName: string
  siteCode: string | null
  customerName: string | null
  checks: CheckRow[]
  byCol: Record<KanbanCol, CheckRow[]>
  counts: Record<KanbanCol, number>
  totalItems: number
  completedItems: number
  nextDue: string | null
  earliestOverdue: string | null
}

export function SiteGroupedView({ checks, itemsMap, sites, onCheckClick, isAdmin = false }: SiteGroupedViewProps) {
  const siteInfoMap = useMemo(() => {
    const m = new Map<string, SiteInfo>()
    for (const s of sites) m.set(s.id, s)
    return m
  }, [sites])

  const [allExpanded, setAllExpanded] = useState(true)
  const [forceKey, setForceKey] = useState(0)

  const groups = useMemo<SiteGroup[]>(() => {
    const today = todayISO()
    const map = new Map<string, SiteGroup>()
    for (const check of checks) {
      const siteId = (check.site_id as string) ?? 'unassigned'
      const info = siteInfoMap.get(siteId)
      const siteName = info?.name ?? check.sites?.name ?? 'Unassigned'
      const siteCode = info?.code ?? null
      const customerField = info?.customers
      const customer = Array.isArray(customerField) ? customerField[0] : customerField
      const customerName = customer?.name ?? null

      if (!map.has(siteId)) {
        map.set(siteId, {
          siteId,
          siteName,
          siteCode,
          customerName,
          checks: [],
          byCol: { scheduled: [], in_progress: [], overdue: [], complete: [] },
          counts: { scheduled: 0, in_progress: 0, overdue: 0, complete: 0 },
          totalItems: 0,
          completedItems: 0,
          nextDue: null,
          earliestOverdue: null,
        })
      }
      const g = map.get(siteId)!
      g.checks.push(check)

      const status = check.status as CheckStatus
      // Map status into the 4 kanban columns — cancelled falls into complete lane like the global kanban
      let col: KanbanCol
      if (status === 'scheduled') col = 'scheduled'
      else if (status === 'in_progress') col = 'in_progress'
      else if (status === 'overdue') col = 'overdue'
      else col = 'complete' // complete + cancelled

      g.byCol[col].push(check)
      g.counts[col] += 1

      g.totalItems += check.item_count ?? 0
      g.completedItems += check.completed_count ?? 0

      const due = check.due_date as string | null
      if (due) {
        if (status !== 'complete' && status !== 'cancelled') {
          if (!g.nextDue || due < g.nextDue) g.nextDue = due
        }
        if (status === 'overdue' || (due < today && status !== 'complete' && status !== 'cancelled')) {
          if (!g.earliestOverdue || due < g.earliestOverdue) g.earliestOverdue = due
        }
      }
    }

    for (const g of map.values()) {
      for (const key of KANBAN_COLS) {
        g.byCol[key].sort((a, b) => ((a.due_date as string) ?? '').localeCompare((b.due_date as string) ?? ''))
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.customerName && b.customerName && a.customerName !== b.customerName) {
        return a.customerName.localeCompare(b.customerName)
      }
      return a.siteName.localeCompare(b.siteName)
    })
  }, [checks, siteInfoMap])

  if (groups.length === 0) return null

  function toggleAll(next: boolean) {
    setAllExpanded(next)
    setForceKey((k) => k + 1)
  }

  const totalChecks = groups.reduce((sum, g) => sum + g.checks.length, 0)
  const totalOverdue = groups.reduce((sum, g) => sum + g.counts.overdue, 0)
  const totalInProgress = groups.reduce((sum, g) => sum + g.counts.in_progress, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-eq-grey">
        <div className="flex items-center gap-3">
          <span>{groups.length} site{groups.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{totalChecks} check{totalChecks !== 1 ? 's' : ''}</span>
          {totalOverdue > 0 && (
            <>
              <span>·</span>
              <span className="text-red-600 font-semibold">{totalOverdue} overdue</span>
            </>
          )}
          {totalInProgress > 0 && (
            <>
              <span>·</span>
              <span className="text-eq-deep font-semibold">{totalInProgress} in progress</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleAll(true)}
            className="px-2 py-1 rounded hover:bg-gray-100 text-eq-deep"
          >
            Expand all
          </button>
          <button
            onClick={() => toggleAll(false)}
            className="px-2 py-1 rounded hover:bg-gray-100 text-eq-deep"
          >
            Collapse all
          </button>
        </div>
      </div>

      {groups.map((group) => (
        <SiteSection
          key={`${group.siteId}-${forceKey}`}
          group={group}
          itemsMap={itemsMap}
          onCheckClick={onCheckClick}
          isAdmin={isAdmin}
          defaultOpen={allExpanded}
        />
      ))}
    </div>
  )
}

function SiteSection({
  group,
  itemsMap,
  onCheckClick,
  isAdmin,
  defaultOpen,
}: {
  group: SiteGroup
  itemsMap: Record<string, MaintenanceCheckItem[]>
  onCheckClick: (check: CheckRow) => void
  isAdmin: boolean
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const total = group.checks.length
  const pctComplete = group.totalItems > 0 ? Math.round((group.completedItems / group.totalItems) * 100) : 0

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-4 py-3 bg-eq-ice hover:bg-eq-ice/80 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-eq-deep mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 text-eq-deep mt-0.5 shrink-0" />}
        <MapPin className="w-4 h-4 text-eq-sky mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-eq-deep">
              {group.siteCode ? `${group.siteCode} — ${group.siteName}` : group.siteName}
            </span>
            {group.customerName && (
              <span className="text-xs text-eq-grey flex items-center gap-1">
                <Factory className="w-3 h-3" />
                {group.customerName}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-xs text-eq-grey">
              {total} check{total !== 1 ? 's' : ''}
            </span>
            {group.totalItems > 0 && (
              <>
                <span className="text-xs text-eq-grey">·</span>
                <span className="text-xs text-eq-grey">
                  {group.completedItems}/{group.totalItems} items ({pctComplete}%)
                </span>
              </>
            )}
            {group.nextDue && (
              <>
                <span className="text-xs text-eq-grey">·</span>
                <span className="text-xs text-eq-grey flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" />
                  Next due {formatDate(group.nextDue)}
                </span>
              </>
            )}
            {group.earliestOverdue && (
              <>
                <span className="text-xs text-eq-grey">·</span>
                <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Oldest overdue {formatDate(group.earliestOverdue)}
                </span>
              </>
            )}
          </div>

          {group.totalItems > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-1 mt-2">
              <div
                className="bg-eq-sky h-1 rounded-full transition-all"
                style={{ width: `${pctComplete}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto text-xs shrink-0 flex-wrap justify-end max-w-[50%]">
          {KANBAN_COLS.map((key) => {
            const n = group.counts[key]
            if (!n) return null
            return (
              <span
                key={key}
                className="px-2 py-0.5 rounded-full bg-white border border-gray-200 flex items-center gap-1.5 text-eq-ink"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${KANBAN_DOT[key]}`} />
                {n} {KANBAN_LABEL[key].toLowerCase()}
              </span>
            )
          })}
        </div>
      </button>

      {open && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {KANBAN_COLS.map((col) => (
              <KanbanColumn
                key={col}
                col={col}
                checks={group.byCol[col]}
                itemsMap={itemsMap}
                onCheckClick={onCheckClick}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KanbanColumn({
  col,
  checks,
  itemsMap,
  onCheckClick,
  isAdmin,
}: {
  col: KanbanCol
  checks: CheckRow[]
  itemsMap: Record<string, MaintenanceCheckItem[]>
  onCheckClick: (check: CheckRow) => void
  isAdmin: boolean
}) {
  return (
    <div className="flex flex-col">
      <div className={`p-3 rounded-lg ${KANBAN_HEADER_BG[col]} border border-gray-200 mb-3`}>
        <h4 className={`font-semibold text-xs uppercase tracking-wide ${KANBAN_HEADER_TEXT[col]}`}>
          {KANBAN_LABEL[col]}
        </h4>
        <p className="text-[11px] text-eq-grey mt-0.5">
          {checks.length} check{checks.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {checks.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center">
            <p className="text-[11px] text-eq-grey">No checks</p>
          </div>
        ) : (
          checks.map((check) => (
            <CheckCard
              key={check.id}
              check={check}
              items={itemsMap[check.id] ?? []}
              onClick={() => onCheckClick(check)}
              isAdmin={isAdmin}
            />
          ))
        )}
      </div>
    </div>
  )
}

function CheckCard({
  check,
  items,
  onClick,
  isAdmin,
}: {
  check: CheckRow
  items: MaintenanceCheckItem[]
  onClick: () => void
  isAdmin: boolean
}) {
  const [pending, startTransition] = useTransition()

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this check? It will be removed from all views. You can restore it from Admin → Archive.')) return
    startTransition(async () => {
      await archiveCheckAction(check.id, false)
    })
  }

  const completedCount = items.filter((i) => i.result !== null).length
  const total = items.length
  const pct = total > 0 ? (completedCount / total) * 100 : 0

  const status = check.status as CheckStatus
  const due = check.due_date as string
  const today = todayISO()
  const dueDelta = due ? daysBetween(due, today) : null
  const isOverdue = status === 'overdue' || (dueDelta !== null && dueDelta < 0 && status !== 'complete' && status !== 'cancelled')
  const dueLabel = (() => {
    if (!due) return null
    if (status === 'complete') return `Completed — due ${formatDate(due)}`
    if (dueDelta === null) return `Due ${formatDate(due)}`
    if (dueDelta < 0) return `${Math.abs(dueDelta)} day${Math.abs(dueDelta) !== 1 ? 's' : ''} overdue`
    if (dueDelta === 0) return 'Due today'
    if (dueDelta <= 14) return `Due in ${dueDelta} day${dueDelta !== 1 ? 's' : ''}`
    return `Due ${formatDate(due)}`
  })()

  const title = formatCheckTitle(check.due_date as string | null, check.custom_name as string | null)
  const jobPlanCode = check.job_plans?.name ?? null
  const frequency = formatFrequency(check.frequency as string | null)
  const wo = (check.maximo_wo_number as string | null) ?? null
  const pm = (check.maximo_pm_number as string | null) ?? null
  const isDark = Boolean(check.is_dark_site)

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      className="relative text-left p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-all duration-200 hover:border-eq-sky group cursor-pointer"
    >
      {isAdmin && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="p-1 rounded hover:bg-red-50 text-eq-grey hover:text-red-600"
            title="Delete check"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <p className="font-semibold text-sm text-eq-ink mb-1.5 line-clamp-2 group-hover:text-eq-sky pr-6">
        {title}
      </p>

      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
        {jobPlanCode && (
          <span className="px-1.5 py-0.5 rounded bg-eq-ice text-eq-deep text-[10px] font-semibold uppercase tracking-wide">
            {jobPlanCode}
          </span>
        )}
        {frequency && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-eq-grey text-[10px] font-medium uppercase tracking-wide">
            {frequency}
          </span>
        )}
        {isDark && (
          <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-medium uppercase tracking-wide flex items-center gap-1">
            <Moon className="w-2.5 h-2.5" />
            Dark
          </span>
        )}
      </div>

      {dueLabel && (
        <p className={`text-[11px] mb-1 flex items-center gap-1 ${isOverdue ? 'text-red-600 font-semibold' : 'text-eq-grey'}`}>
          <CalendarClock className="w-3 h-3" />
          {dueLabel}
        </p>
      )}

      <p className="text-[11px] text-eq-grey mb-1 flex items-center gap-1">
        <User className="w-3 h-3" />
        {check.assignee_name ?? 'Unassigned'}
      </p>

      {(wo || pm) && (
        <p className="text-[11px] text-eq-grey mb-1.5 flex items-center gap-1 font-mono">
          <FileText className="w-3 h-3" />
          {wo ? `WO ${wo}` : `PM ${pm}`}
        </p>
      )}

      <div className="mb-2 mt-1.5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-semibold text-eq-grey">Progress</p>
          <p className="text-[11px] font-semibold text-eq-grey">
            {completedCount}/{total}
          </p>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1">
          <div
            className="bg-eq-sky h-1 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <StatusBadge status={statusToBadge(status)} />
        <Eye className="w-3.5 h-3.5 text-eq-grey opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}
