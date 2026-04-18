import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Clock,
  Flag,
  Package,
  Plus,
  Upload,
  Users,
} from 'lucide-react'
import { navigate } from '../lib/router'
import { useJobsDashboard } from '../hooks/useJobsDashboard'
import { timeAgo, formatPct } from '../lib/format'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Eyebrow } from '../components/ui/Eyebrow'
import { KPI } from '../components/ui/KPI'
import { Pill } from '../components/ui/Pill'
import { ProgressBar } from '../components/ui/ProgressBar'
import { cn } from '../lib/cn'
import type { JobRow } from '../hooks/useJobsDashboard'

type Props = {
  capturerName: string | null
}

export function DashboardPage({ capturerName }: Props) {
  const { rows, totals, loading, error } = useJobsDashboard()
  const firstName = capturerName?.split(/\s+/)[0] || 'Capturer'

  const openJobs = rows
    .filter(r => r.job.active && r.done < r.total)
    .slice(0, 6)

  const readyForExport = rows
    .filter(r => r.total > 0 && r.done === r.total)
    .slice(0, 3)

  const flaggedJobs = rows
    .filter(r => r.flagged > 0)
    .sort((a, b) => b.flagged - a.flagged)
    .slice(0, 4)

  return (
    <div className="max-w-[1320px] mx-auto">
      {/* Greeting */}
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <Eyebrow>Today</Eyebrow>
          <div className="text-[28px] font-bold tracking-tight leading-tight mt-1">
            Welcome back, {firstName}.
          </div>
          <div className="text-[13px] text-muted mt-1">
            {totals.activeJobs > 0
              ? `${totals.activeJobs} active ${totals.activeJobs === 1 ? 'job' : 'jobs'} · ${totals.pendingSync} pending to sync`
              : 'No active jobs right now — pick one from the list or import a new template.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={Upload} onClick={() => navigate('/import')}>
            Import template
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => navigate('/jobs')}>
            New job
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPI label="Active jobs" value={totals.activeJobs} icon={Briefcase} tone="info" />
        <KPI label="Assets captured" value={totals.capturedAssets} icon={Package} tone="neutral" />
        <KPI
          label="Pending sync"
          value={totals.pendingSync}
          icon={Clock}
          tone={totals.pendingSync > 0 ? 'warn' : 'ok'}
        />
        <KPI
          label="Flagged"
          value={totals.flagged}
          icon={Flag}
          tone={totals.flagged > 0 ? 'bad' : 'neutral'}
        />
      </div>

      {error && (
        <Card className="mb-4 border-bad-bg bg-bad-bg/40">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="text-bad mt-0.5 shrink-0" />
            <div className="text-[13px]">
              <div className="font-semibold text-bad-fg">Couldn't refresh from Supabase</div>
              <div className="text-muted mt-0.5">{error}</div>
              <div className="text-muted mt-1">Showing cached data.</div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr,340px]">
        {/* Left column: job stack */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">
              Open jobs
            </div>
            <button
              onClick={() => navigate('/jobs')}
              className="text-[12px] font-semibold text-sky-deep inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              View all <ArrowRight size={12} />
            </button>
          </div>

          {loading && openJobs.length === 0 ? (
            <Card>
              <div className="text-[13px] text-muted">Loading jobs…</div>
            </Card>
          ) : openJobs.length === 0 ? (
            <Card className="text-center py-10">
              <Briefcase size={22} className="mx-auto text-gray-400 mb-2" />
              <div className="text-[14px] font-semibold text-ink">No open jobs</div>
              <div className="text-[12px] text-muted mt-1">
                Import a template to start a new capture.
              </div>
              <div className="mt-3">
                <Button variant="ghost" icon={Upload} onClick={() => navigate('/import')}>
                  Import template
                </Button>
              </div>
            </Card>
          ) : (
            openJobs.map(r => <JobRowCard key={r.job.id} row={r} />)
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-3">
          <AttentionCard flagged={flaggedJobs} ready={readyForExport} />
          <ActivityCard rows={rows} />
          <CrewCard capturerName={capturerName} />
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function JobRowCard({ row }: { row: JobRow }) {
  const { job, done, total, pending, flagged, updatedAt } = row
  const pct = formatPct(done, total)
  const complete = total > 0 && done === total
  return (
    <Card
      hoverable
      onClick={() => navigate(`/j/${job.slug ?? job.id}`)}
      className="flex items-center gap-4"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[15px] font-bold text-ink truncate">
            {job.name ?? job.slug ?? job.id.slice(0, 8)}
          </div>
          {complete && <Pill tone="ok" size="sm">Ready</Pill>}
          {pending > 0 && <Pill tone="warn" size="sm">{pending} pending</Pill>}
          {flagged > 0 && <Pill tone="bad" size="sm">{flagged} flagged</Pill>}
        </div>
        <div className="text-[11px] font-mono text-sky-deep mt-0.5">
          {job.site_code} · {job.classification_code}
        </div>
        <div className="flex items-center gap-2.5 mt-2 min-w-0">
          <div className="flex-1"><ProgressBar done={done} total={total} height={5} /></div>
          <div className="text-[11px] font-mono font-bold text-muted tabular-nums shrink-0">
            {done}/{total}
          </div>
          <div className="text-[11px] font-mono font-bold text-ink tabular-nums w-9 text-right shrink-0">
            {pct}%
          </div>
        </div>
      </div>
      <div className="text-[11px] text-muted whitespace-nowrap shrink-0">
        {timeAgo(updatedAt)}
      </div>
      <ArrowRight size={16} className="text-gray-400 shrink-0" />
    </Card>
  )
}

function AttentionCard({
  flagged,
  ready,
}: {
  flagged: JobRow[]
  ready: JobRow[]
}) {
  const empty = flagged.length === 0 && ready.length === 0
  return (
    <Card padding={0}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
          Needs attention
        </div>
        <Flag size={14} className="text-gray-400" />
      </div>
      {empty ? (
        <div className="px-4 pb-4 text-[12px] text-muted">
          Nothing flagged and nothing ready to export.
        </div>
      ) : (
        <div className="flex flex-col">
          {ready.map(r => (
            <AttentionItem
              key={`ready-${r.job.id}`}
              tone="ok"
              title={r.job.name ?? r.job.site_code}
              meta={`${r.job.site_code} · Ready to export`}
              onClick={() => navigate(`/j/${r.job.slug ?? r.job.id}/export`)}
            />
          ))}
          {flagged.map(r => (
            <AttentionItem
              key={`flag-${r.job.id}`}
              tone="bad"
              title={r.job.name ?? r.job.site_code}
              meta={`${r.flagged} flagged capture${r.flagged === 1 ? '' : 's'}`}
              onClick={() => navigate(`/j/${r.job.slug ?? r.job.id}`)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function AttentionItem({
  tone,
  title,
  meta,
  onClick,
}: {
  tone: 'ok' | 'bad' | 'warn'
  title: string
  meta: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-4 py-2.5 text-left border-t border-gray-100',
        'hover:bg-gray-50 transition-colors duration-120 cursor-pointer',
      )}
    >
      <Pill tone={tone} size="sm" dot>{tone === 'ok' ? 'Ready' : tone === 'bad' ? 'Flag' : 'Warn'}</Pill>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink truncate">{title}</div>
        <div className="text-[11px] text-muted truncate">{meta}</div>
      </div>
      <ArrowRight size={14} className="text-gray-400 shrink-0" />
    </button>
  )
}

function ActivityCard({ rows }: { rows: JobRow[] }) {
  const recent = rows
    .filter(r => r.updatedAt)
    .sort((a, b) => (b.updatedAt! > a.updatedAt! ? 1 : -1))
    .slice(0, 4)
  return (
    <Card padding={0}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
          Recent activity
        </div>
        <Activity size={14} className="text-gray-400" />
      </div>
      {recent.length === 0 ? (
        <div className="px-4 pb-4 text-[12px] text-muted">
          No captures yet.
        </div>
      ) : (
        <div className="flex flex-col">
          {recent.map(r => (
            <div
              key={r.job.id}
              className="px-4 py-2.5 border-t border-gray-100 text-[13px]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-ink truncate">
                  {r.job.name ?? r.job.site_code}
                </div>
                <div className="text-[11px] text-muted whitespace-nowrap">
                  {timeAgo(r.updatedAt)}
                </div>
              </div>
              <div className="text-[11px] font-mono text-muted mt-0.5">
                {r.done}/{r.total} assets captured
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function CrewCard({ capturerName }: { capturerName: string | null }) {
  return (
    <Card padding={0}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
          Crew
        </div>
        <Users size={14} className="text-gray-400" />
      </div>
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-sky text-white text-[12px] font-bold shrink-0">
            {capturerName
              ? capturerName.split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
              : 'AU'}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink truncate">
              {capturerName ?? 'No capturer set'}
            </div>
            <div className="text-[11px] text-muted">
              {capturerName ? 'Captures stamped with this name' : 'Set a name in the top bar'}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
