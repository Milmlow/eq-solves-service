import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  FileSpreadsheet,
  Layers,
  ListChecks,
  RefreshCw,
  ServerCog,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { navigate } from '../lib/router'
import { supabase } from '../lib/supabase'
import { allCaptures, pendingCount } from '../lib/queue'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { KpiSmall } from '../components/ui/KPI'
import { Pill } from '../components/ui/Pill'

type CheckStatus = 'pending' | 'ok' | 'warn' | 'fail'

interface DiagCheck {
  id: string
  label: string
  status: CheckStatus
  detail?: string
  icon: LucideIcon
}

const STABLE_JOB_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const STABLE_JOB_SLUG = 'sy6-assets'

const INITIAL_CHECKS: DiagCheck[] = [
  { id: 'config',       label: 'Runtime config loaded',                 status: 'pending', icon: ServerCog },
  { id: 'connectivity', label: 'Supabase reachable',                    status: 'pending', icon: Wifi },
  { id: 'schema',       label: 'Schema deployed (classifications)',     status: 'pending', icon: Database },
  { id: 'fields',       label: 'Classification fields seeded',          status: 'pending', icon: Layers },
  { id: 'job',          label: 'SY6 BREAKER job exists',                status: 'pending', icon: FileSpreadsheet },
  { id: 'assets',       label: 'SY6 assets loaded (expect 101)',        status: 'pending', icon: ListChecks },
  { id: 'captures',     label: 'Captures table writable (probed)',      status: 'pending', icon: Activity },
]

export function DebugPage() {
  const [checks, setChecks] = useState<DiagCheck[]>(INITIAL_CHECKS)
  const [running, setRunning] = useState(false)
  const [durationMs, setDurationMs] = useState<number | null>(null)

  const update = (id: string, patch: Partial<DiagCheck>) => {
    setChecks((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const runChecks = async () => {
    setRunning(true)
    setDurationMs(null)
    const started = performance.now()
    setChecks((cs) =>
      cs.map((c) => ({ ...c, status: 'pending' as const, detail: undefined })),
    )

    // 1. Config
    const cfg = window.__EQ_CONFIG__ ?? {}
    const url = cfg.supabaseUrl || ''
    const key = cfg.supabaseAnonKey || ''
    if (!url || !key || key === 'REPLACE_ME_WITH_ANON_KEY') {
      update('config', {
        status: 'fail',
        detail:
          'config.js is missing or still has the placeholder anon key. Edit /config.js on the deployed site.',
      })
      setRunning(false)
      setDurationMs(performance.now() - started)
      return
    }
    update('config', {
      status: 'ok',
      detail: `URL: ${url}  ·  Key: ${key.slice(0, 10)}…${key.slice(-6)}`,
    })

    // 2. Connectivity
    try {
      const { error } = await supabase
        .from('classifications')
        .select('code', { count: 'exact', head: true })
      if (error) throw error
      update('connectivity', { status: 'ok', detail: 'HTTP reachable' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      update('connectivity', { status: 'fail', detail: msg })
      setRunning(false)
      setDurationMs(performance.now() - started)
      return
    }

    // 3. Schema
    const { data: classData, error: classErr } = await supabase
      .from('classifications')
      .select('code')
    if (classErr || !classData) {
      update('schema', {
        status: 'fail',
        detail: classErr?.message ?? 'No rows returned',
      })
    } else {
      update('schema', {
        status: 'ok',
        detail: `${classData.length} classifications`,
      })
    }

    // 4. Fields
    const { error: fieldErr, count } = await supabase
      .from('classification_fields')
      .select('*', { count: 'exact', head: true })
    if (fieldErr) {
      update('fields', { status: 'fail', detail: fieldErr.message })
    } else {
      update('fields', { status: 'ok', detail: `${count ?? '?'} field rows` })
    }

    // 5. Job
    const jobResp = await supabase
      .from('jobs')
      .select('*')
      .eq('id', STABLE_JOB_ID)
      .maybeSingle()
    const jobErr = jobResp.error
    const job = jobResp.data as
      | { name: string | null; site_code: string; classification_code: string }
      | null
    if (jobErr || !job) {
      update('job', {
        status: 'fail',
        detail:
          jobErr?.message ?? 'SY6 BREAKER job not found. Did you run setup.sql?',
      })
    } else {
      update('job', {
        status: 'ok',
        detail: `${job.name ?? '—'} (${job.site_code} · ${job.classification_code})`,
      })
    }

    // 6. Assets
    const assetsResp = await supabase
      .from('assets')
      .select('id, description')
      .eq('job_id', STABLE_JOB_ID)
    const assetsErr = assetsResp.error
    const assetsData =
      (assetsResp.data as Array<{ id: string; description: string }> | null) ??
      null
    if (assetsErr) {
      update('assets', { status: 'fail', detail: assetsErr.message })
    } else {
      const n = assetsData?.length ?? 0
      update('assets', {
        status: n === 101 ? 'ok' : n === 0 ? 'fail' : 'warn',
        detail: `${n} assets (expected 101)`,
      })
    }

    // 7. Captures probe
    if (assetsData && assetsData.length > 0) {
      const testAssetId = assetsData[0].id
      const fieldsResp = await supabase
        .from('classification_fields')
        .select('id')
        .eq('classification_code', 'BREAKER')
        .limit(1)
      const fields = fieldsResp.data as Array<{ id: number }> | null
      const testFieldId = fields?.[0]?.id
      if (testFieldId) {
        const { error: writeErr } = await supabase.from('captures').upsert(
          {
            asset_id: testAssetId,
            classification_field_id: testFieldId,
            value: '__DEBUG_PROBE__',
            captured_by: '__debug__',
            captured_at: new Date().toISOString(),
            notes: null,
            flagged: false,
          } as never,
          { onConflict: 'asset_id,classification_field_id' },
        )
        if (writeErr) {
          update('captures', { status: 'fail', detail: writeErr.message })
        } else {
          await supabase
            .from('captures')
            .delete()
            .eq('asset_id', testAssetId)
            .eq('classification_field_id', testFieldId)
            .eq('value', '__DEBUG_PROBE__')
          update('captures', { status: 'ok', detail: 'Probe write/delete OK' })
        }
      } else {
        update('captures', {
          status: 'fail',
          detail: 'No BREAKER fields — cannot probe',
        })
      }
    } else {
      update('captures', { status: 'fail', detail: 'No assets to probe against' })
    }

    setRunning(false)
    setDurationMs(performance.now() - started)
  }

  useEffect(() => {
    void runChecks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    let pass = 0
    let warn = 0
    let fail = 0
    for (const c of checks) {
      if (c.status === 'ok') pass++
      else if (c.status === 'warn') warn++
      else if (c.status === 'fail') fail++
    }
    return { pass, warn, fail }
  }, [checks])

  const localTotal = allCaptures().length
  const localPending = pendingCount()
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true
  const duration = durationMs !== null
    ? `${(durationMs / 1000).toFixed(1)}s`
    : running
      ? '…'
      : '—'

  return (
    <div className="max-w-[900px] mx-auto">
      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <KpiSmall label="Passed"   value={stats.pass}  tone="ok" />
        <KpiSmall label="Warnings" value={stats.warn}  tone={stats.warn ? 'warn' : 'neutral'} />
        <KpiSmall label="Failed"   value={stats.fail}  tone={stats.fail ? 'bad' : 'neutral'} />
        <KpiSmall label="Duration" value={duration}    tone="neutral" />
      </div>

      {/* ── Diagnostic checks ─────────────────────────────────── */}
      <Card padding={0}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-bold text-ink">Diagnostic checks</div>
            <div className="text-[11px] text-muted mt-0.5">
              Verify the app is healthy before you go on site.
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            onClick={runChecks}
            disabled={running}
          >
            {running ? 'Running…' : 'Re-run'}
          </Button>
        </div>
        {checks.map((c, i) => {
          const Icon = c.icon
          return (
            <div
              key={c.id}
              className={
                'flex items-center gap-3 px-4 py-3 ' +
                (i < checks.length - 1 ? 'border-b border-gray-100' : '')
              }
            >
              <div className="flex items-center justify-center h-8 w-8 rounded-md bg-ice text-sky-deep shrink-0">
                <Icon size={14} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink">
                  {c.label}
                </div>
                {c.detail && (
                  <div className="text-[11px] text-muted font-mono mt-0.5 break-all">
                    {c.detail}
                  </div>
                )}
              </div>
              <StatusPill status={c.status} />
            </div>
          )
        })}
      </Card>

      {/* ── Local state + quick links ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mt-4">
        <Card padding={0}>
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-[13px] font-bold text-ink">Local state</div>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            <LocalStat
              icon={online ? Wifi : WifiOff}
              label="Connection"
              value={online ? 'Online' : 'Offline'}
              tone={online ? 'ok' : 'warn'}
            />
            <LocalStat
              icon={Database}
              label="Local captures"
              value={String(localTotal)}
              tone="neutral"
            />
            <LocalStat
              icon={Activity}
              label="Pending sync"
              value={String(localPending)}
              tone={localPending ? 'warn' : 'ok'}
            />
            <LocalStat
              icon={Cpu}
              label="User agent"
              value={
                typeof navigator !== 'undefined'
                  ? navigator.userAgent.split(' ')[0]
                  : '—'
              }
              tone="neutral"
              mono
            />
          </div>
        </Card>

        <Card padding={0}>
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-[13px] font-bold text-ink">Quick links</div>
          </div>
          <div className="p-2 flex flex-col">
            <QuickLink onClick={() => navigate(`/j/${STABLE_JOB_SLUG}`)}>
              Open SY6 BREAKER job →
            </QuickLink>
            <QuickLink onClick={() => navigate(`/j/${STABLE_JOB_SLUG}/admin`)}>
              Progress matrix →
            </QuickLink>
            <QuickLink onClick={() => navigate(`/j/${STABLE_JOB_SLUG}/export`)}>
              Export →
            </QuickLink>
            <QuickLink onClick={() => navigate('/import')}>
              Import template →
            </QuickLink>
          </div>
        </Card>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: CheckStatus }) {
  if (status === 'pending') {
    return (
      <Pill tone="neutral" size="sm">
        Running
      </Pill>
    )
  }
  if (status === 'ok') {
    return (
      <Pill tone="ok" size="sm">
        <CheckCircle2 size={9} strokeWidth={2.5} />
        Pass
      </Pill>
    )
  }
  if (status === 'warn') {
    return (
      <Pill tone="warn" size="sm">
        <AlertTriangle size={9} strokeWidth={2.5} />
        Warn
      </Pill>
    )
  }
  return (
    <Pill tone="bad" size="sm">
      <XCircle size={9} strokeWidth={2.5} />
      Fail
    </Pill>
  )
}

function LocalStat({
  icon: Icon,
  label,
  value,
  tone,
  mono,
}: {
  icon: LucideIcon
  label: string
  value: string
  tone: 'ok' | 'warn' | 'neutral'
  mono?: boolean
}) {
  const ring =
    tone === 'ok'
      ? 'text-ok-fg bg-ok-bg'
      : tone === 'warn'
        ? 'text-warn-fg bg-warn-bg'
        : 'text-sky-deep bg-ice'
  return (
    <div className="flex items-start gap-2 min-w-0">
      <div
        className={
          'flex items-center justify-center h-7 w-7 rounded-md shrink-0 ' + ring
        }
      >
        <Icon size={12} strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
          {label}
        </div>
        <div
          className={
            'text-[13px] font-semibold text-ink truncate ' +
            (mono ? 'font-mono text-[12px]' : '')
          }
          title={value}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function QuickLink({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-md text-[13px] font-semibold text-ink hover:bg-ice hover:text-sky-deep transition-colors"
    >
      {children}
    </button>
  )
}
