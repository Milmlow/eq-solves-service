/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /do — action-first work queue (D3.3b).
 *
 * Shows today's work orders assigned to the current user — ranked,
 * filterable by tab (All / Priority / Completed), with one-tap Start
 * and Mark complete actions plus an Escalate path to create a defect.
 *
 * Mobile-first. Max 640px centred on desktop. Technicians are the
 * primary user — everything reachable with one thumb.
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { KindPill } from '@/components/ui/KindPill'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

// ─── types ────────────────────────────────────────────────────────────────────

type WoStatus = 'open' | 'in_progress' | 'overdue' | 'completed'

interface WorkOrder {
  id: string
  ref: string | null
  site_name: string | null
  kind: string | null
  status: WoStatus
  due_date: string | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDueTime(dueDateIso: string | null, status: WoStatus): string {
  if (!dueDateIso) return ''
  const d = new Date(dueDateIso)
  const time = d.toLocaleTimeString('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Australia/Sydney',
  })
  if (status === 'overdue') return `Overdue — was ${time}`
  return `Due ${time}`
}

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Australia/Sydney',
  })
}

// ─── WO card ──────────────────────────────────────────────────────────────────

function WoCard({
  wo,
  onStart,
  onComplete,
  onEscalate,
}: {
  wo: WorkOrder
  onStart: (id: string) => void
  onComplete: (id: string) => void
  onEscalate: (id: string) => void
}) {
  const isOverdue = wo.status === 'overdue'

  // Map DB status → kit StatusBadge status
  const badgeStatus = ((): 'open' | 'in-progress' | 'overdue' | 'closed' | 'await' => {
    if (wo.status === 'in_progress') return 'in-progress'
    if (wo.status === 'completed') return 'closed'
    if (wo.status === 'overdue') return 'overdue'
    return 'open'
  })()

  return (
    <Link
      href={`/maintenance/${wo.id}`}
      onClick={(e) => {
        // Allow buttons inside the card to fire without navigating
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
      className="block"
    >
      <Card
        className={`relative cursor-pointer hover:border-eq-sky transition-colors${
          isOverdue ? ' border-l-[3px]' : ''
        }`}
        style={isOverdue ? { borderLeftColor: '#B91C1C' } : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            {wo.ref && (
              <div className="text-[11px] text-gray-500 font-mono">{wo.ref}</div>
            )}
            <div className="text-[15px] font-bold text-eq-ink truncate">
              {wo.site_name ?? '—'}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <KindPill kind={wo.kind} />
              <StatusBadge status={badgeStatus} />
            </div>
            {wo.due_date && (
              <div className={`text-xs ${isOverdue ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>
                {formatDueTime(wo.due_date, wo.status)}
              </div>
            )}
          </div>

          {/* Quick actions — right rail */}
          <div className="flex flex-col gap-1.5 shrink-0">
            {(wo.status === 'open' || wo.status === 'overdue') && (
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onStart(wo.id) }}
              >
                Start
              </Button>
            )}
            {wo.status === 'in_progress' && (
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onComplete(wo.id) }}
              >
                Mark complete
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onEscalate(wo.id) }}
            >
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />
              Escalate
            </Button>
          </div>
        </div>
      </Card>
    </Link>
  )
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: 'all' | 'priority' | 'completed' }) {
  const messages: Record<typeof tab, { heading: string; body: string }> = {
    all:       { heading: "You're all clear", body: 'No work orders are assigned to you today.' },
    priority:  { heading: 'No priority items', body: 'No overdue or high-priority jobs right now.' },
    completed: { heading: 'None completed yet', body: 'Jobs you finish today will appear here.' },
  }
  const m = messages[tab]
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <CheckCircle2 className="w-8 h-8 text-gray-400 mb-3" />
      <p className="font-semibold text-eq-ink text-sm">{m.heading}</p>
      <p className="text-sm text-gray-500 mt-1">{m.body}</p>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type Tab = 'all' | 'priority' | 'completed'

export default function DoQueuePage() {
  const router = useRouter()
  const confirm = useConfirm()

  const [loading, setLoading] = useState(true)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [completedToday, setCompletedToday] = useState<WorkOrder[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [escalateId, setEscalateId] = useState<string | null>(null)
  const [escalateText, setEscalateText] = useState('')
  const [escalateSubmitting, setEscalateSubmitting] = useState(false)

  const today = todayIso()

  const fetchWOs = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [{ data: active }, { data: completed }] = await Promise.all([
      supabase
        .from('maintenance_checks')
        .select('id, site_id, kind, status, due_date, sites(name)')
        .eq('assigned_to', user.id)
        .in('status', ['open', 'in_progress', 'overdue'])
        .filter('due_date', 'gte', `${today}T00:00:00`)
        .filter('due_date', 'lt', `${today}T23:59:59`)
        .order('due_date', { ascending: true }),
      supabase
        .from('maintenance_checks')
        .select('id, site_id, kind, status, due_date, sites(name)')
        .eq('assigned_to', user.id)
        .eq('status', 'complete')
        .filter('updated_at', 'gte', `${today}T00:00:00`)
        .order('updated_at', { ascending: false })
        .limit(50),
    ])

    function mapRow(r: Record<string, unknown>): WorkOrder {
      const sitesField = r.sites as { name?: string } | null
      return {
        id: r.id as string,
        ref: r.id ? `WO-${(r.id as string).slice(0, 8).toUpperCase()}` : null,
        site_name: sitesField?.name ?? null,
        kind: r.kind as string | null,
        status: r.status as WoStatus,
        due_date: r.due_date as string | null,
      }
    }

    setWorkOrders((active ?? []).map(mapRow))
    setCompletedToday((completed ?? []).map(mapRow))
    setLoading(false)
  }, [today])

  useEffect(() => { void fetchWOs() }, [fetchWOs])

  async function handleStart(id: string) {
    const supabase = createClient()
    await supabase
      .from('maintenance_checks')
      .update({ status: 'in_progress' })
      .eq('id', id)
    setWorkOrders((prev) =>
      prev.map((wo) => wo.id === id ? { ...wo, status: 'in_progress' } : wo)
    )
  }

  async function handleComplete(id: string) {
    const ok = await confirm({
      title: 'Mark as complete?',
      message: "Mark this job as complete? You can't undo this without a supervisor.",
      confirmLabel: 'Mark complete',
    })
    if (!ok) return
    const supabase = createClient()
    await supabase
      .from('maintenance_checks')
      .update({ status: 'complete' })
      .eq('id', id)
    const completed = workOrders.find((wo) => wo.id === id)
    if (completed) {
      setCompletedToday((prev) => [{ ...completed, status: 'completed' }, ...prev])
    }
    setWorkOrders((prev) => prev.filter((wo) => wo.id !== id))
    router.refresh()
  }

  async function handleEscalateSubmit() {
    if (!escalateId || !escalateText.trim()) return
    setEscalateSubmitting(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const wo = workOrders.find((w) => w.id === escalateId) ?? completedToday.find((w) => w.id === escalateId)
    // Get tenant_id for this user
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user?.id ?? '')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (membership?.tenant_id) {
      await supabase
        .from('defects')
        .insert({
          check_id: escalateId,
          description: escalateText.trim(),
          title: `Escalated from Do screen`,
          status: 'open',
          raised_by: user?.id ?? null,
          tenant_id: membership.tenant_id,
          source: 'manual',
          severity: 'medium',
        })
    }
    setEscalateSubmitting(false)
    setEscalateId(null)
    setEscalateText('')
  }

  // Tab counts
  const allWos = workOrders
  const priorityWos = workOrders.filter(
    (wo) => wo.status === 'overdue'
  )
  const openCount = workOrders.length
  const priorityCount = priorityWos.length

  const tabItems: { key: Tab; label: string; count: number }[] = [
    { key: 'all',       label: 'All',       count: allWos.length },
    { key: 'priority',  label: 'Priority',  count: priorityCount },
    { key: 'completed', label: 'Completed', count: completedToday.length },
  ]

  const visibleWos =
    activeTab === 'all'       ? allWos :
    activeTab === 'priority'  ? priorityWos :
    completedToday

  return (
    <div className="max-w-[640px] mx-auto space-y-4">
      <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Do' }]} />

      {/* ── Summary bar ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10">
        <Card className="p-3">
          {loading ? (
            <div className="flex gap-6">
              <Skeleton shape="text" width="120px" />
              <Skeleton shape="text" width="60px" />
              <Skeleton shape="text" width="72px" />
            </div>
          ) : openCount === 0 && completedToday.length === 0 ? (
            <div>
              <p className="font-semibold text-eq-ink text-sm">Nothing assigned today</p>
              <p className="text-xs text-gray-500 mt-0.5">Check back later or ask your supervisor.</p>
            </div>
          ) : (
            <div className="flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-xs text-gray-500">{todayLabel()}</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-sm font-bold text-eq-ink tabular-nums">{openCount}</p>
                  <p className="text-[11px] text-gray-500">open</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-red-700 tabular-nums">{priorityCount}</p>
                  <p className="text-[11px] text-gray-500">priority</p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Tab strip ────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabItems.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === key
                ? 'border-eq-sky text-eq-sky'
                : 'border-transparent text-gray-500 hover:text-eq-ink'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                activeTab === key ? 'bg-eq-ice text-eq-deep' : 'bg-gray-100 text-gray-600'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Card list ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-2">
              <Skeleton shape="text" width="60px" />
              <Skeleton shape="text" width="180px" />
              <Skeleton shape="text" width="120px" />
            </Card>
          ))}
        </div>
      ) : visibleWos.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <div className="space-y-3">
          {visibleWos.map((wo) => (
            <WoCard
              key={wo.id}
              wo={wo}
              onStart={handleStart}
              onComplete={handleComplete}
              onEscalate={(id) => { setEscalateId(id); setEscalateText('') }}
            />
          ))}
        </div>
      )}

      {/* ── Escalate modal ───────────────────────────────────────────────── */}
      <Modal
        open={escalateId !== null}
        onClose={() => { setEscalateId(null); setEscalateText('') }}
        title="Escalate — create a defect"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-eq-ink">Describe the issue</span>
            <textarea
              className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-eq-ink placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky"
              rows={4}
              placeholder="What needs attention?"
              value={escalateText}
              onChange={(e) => setEscalateText(e.target.value)}
            />
          </label>
          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setEscalateId(null); setEscalateText('') }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!escalateText.trim() || escalateSubmitting}
              onClick={() => void handleEscalateSubmit()}
            >
              {escalateSubmitting ? 'Submitting…' : 'Create defect'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
