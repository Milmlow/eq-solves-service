import { useState } from 'react'
import { ChevronRight, Plus, Search, Upload } from 'lucide-react'
import { navigate } from '../lib/router'
import { useJobsDashboard } from '../hooks/useJobsDashboard'
import type { JobRow } from '../hooks/useJobsDashboard'
import { timeAgo } from '../lib/format'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Pill } from '../components/ui/Pill'
import { ProgressBar } from '../components/ui/ProgressBar'
import { cn } from '../lib/cn'

type Filter = 'active' | 'ready' | 'all'

export function JobsListPage() {
  const { rows, loading } = useJobsDashboard()
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')

  const counts = {
    active: rows.filter(r => r.job.active && r.done < r.total).length,
    ready:  rows.filter(r => r.total > 0 && r.done === r.total).length,
    all:    rows.length,
  }

  let visible = rows
  if (filter === 'active') visible = visible.filter(r => r.job.active && r.done < r.total)
  if (filter === 'ready')  visible = visible.filter(r => r.total > 0 && r.done === r.total)
  if (query) {
    const q = query.toLowerCase()
    visible = visible.filter(r => {
      const haystack = [
        r.job.name ?? '',
        r.job.site_code,
        r.job.classification_code,
        r.job.client_code,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  return (
    <div className="max-w-[1320px] mx-auto">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <div className="text-[22px] font-bold tracking-tight leading-tight">Jobs</div>
          <div className="text-[13px] text-muted mt-0.5">
            Pick a job to open its assets, or import a new template.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={Upload} onClick={() => navigate('/import')}>
            Import template
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => navigate('/import')}>
            New job
          </Button>
        </div>
      </div>

      <Card padding={0}>
        {/* Filter + search toolbar */}
        <div className="flex items-center gap-3 px-3.5 py-3 border-b border-gray-100">
          <div className="flex gap-1 bg-gray-50 p-[3px] rounded-md">
            <FilterTab active={filter === 'active'} count={counts.active} onClick={() => setFilter('active')}>
              Active
            </FilterTab>
            <FilterTab active={filter === 'ready'} count={counts.ready} onClick={() => setFilter('ready')}>
              Ready to export
            </FilterTab>
            <FilterTab active={filter === 'all'} count={counts.all} onClick={() => setFilter('all')}>
              All jobs
            </FilterTab>
          </div>
          <div className="flex-1" />
          <Input
            value={query}
            onChange={setQuery}
            placeholder="Search jobs…"
            icon={Search}
            className="w-60"
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-gray-50">
                <Th>Job</Th>
                <Th>Site · Class</Th>
                <Th>Client</Th>
                <Th>Progress</Th>
                <Th align="center">Pending</Th>
                <Th align="center">Flagged</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-[13px] text-muted">
                    Loading jobs…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-10 text-center">
                    <div className="text-[14px] font-semibold text-ink">
                      {rows.length === 0 ? 'No jobs yet' : 'No jobs match that filter'}
                    </div>
                    <div className="text-[12px] text-muted mt-1">
                      {rows.length === 0
                        ? 'Import a template to create the first one.'
                        : 'Try a different filter or clear the search.'}
                    </div>
                  </td>
                </tr>
              )}
              {visible.map((row, i) => (
                <JobTableRow key={row.job.id} row={row} last={i === visible.length - 1} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── Internals ─────────────────────────────────────────────────────────────

function FilterTab({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean
  count: number
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1.5 rounded border-0 text-[12px] font-semibold cursor-pointer',
        'transition-colors duration-120',
        active
          ? 'bg-white text-ink shadow-xs'
          : 'bg-transparent text-muted hover:text-ink',
      )}
    >
      {children}
      <span
        className={cn(
          'ml-1 px-[5px] py-[1px] rounded-full text-[10px] font-bold',
          active ? 'bg-ice text-sky-deep' : 'bg-gray-200 text-muted',
        )}
      >
        {count}
      </span>
    </button>
  )
}

function JobTableRow({ row, last }: { row: JobRow; last: boolean }) {
  const { job, done, total, pending, flagged, updatedAt } = row
  return (
    <tr
      onClick={() => navigate(`/j/${job.slug ?? job.id}`)}
      className={cn(
        'cursor-pointer hover:bg-gray-50 transition-colors duration-120',
        !last && 'border-b border-gray-100',
      )}
    >
      <Td>
        <div className="font-semibold text-ink truncate">
          {job.name ?? job.slug ?? job.id.slice(0, 8)}
        </div>
      </Td>
      <Td>
        <code className="text-[11px] font-mono text-sky-deep">
          {job.site_code} · {job.classification_code}
        </code>
      </Td>
      <Td className="text-muted">{job.client_code}</Td>
      <Td>
        <div className="flex items-center gap-2 min-w-[140px]">
          <div className="flex-1"><ProgressBar done={done} total={total} height={5} /></div>
          <span className="text-[11px] font-mono font-bold text-muted tabular-nums min-w-[48px] text-right">
            {done}/{total}
          </span>
        </div>
      </Td>
      <Td align="center">
        {pending > 0 ? <Pill tone="warn" size="sm">{pending}</Pill> : <span className="text-gray-300">—</span>}
      </Td>
      <Td align="center">
        {flagged > 0 ? <Pill tone="bad" size="sm">{flagged}</Pill> : <span className="text-gray-300">—</span>}
      </Td>
      <Td className="text-muted text-[12px]">{timeAgo(updatedAt)}</Td>
      <Td>
        <ChevronRight size={14} className="text-gray-400" />
      </Td>
    </tr>
  )
}

function Th({
  children,
  align,
}: {
  children?: React.ReactNode
  align?: 'left' | 'center' | 'right'
}) {
  return (
    <th
      className={cn(
        'py-2.5 px-3.5 font-bold text-[10px] uppercase tracking-[0.06em] text-muted',
        'border-b border-gray-200',
      )}
      style={{ textAlign: align ?? 'left' }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align,
  className,
}: {
  children?: React.ReactNode
  align?: 'left' | 'center' | 'right'
  className?: string
}) {
  return (
    <td
      className={cn('py-3 px-3.5 align-middle', className)}
      style={{ textAlign: align ?? 'left' }}
    >
      {children}
    </td>
  )
}
