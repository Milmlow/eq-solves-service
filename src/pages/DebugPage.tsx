import { useEffect, useState } from 'react'
import { navigate } from '../lib/router'
import { supabase } from '../lib/supabase'
import { TopBar } from '../components/TopBar'
import { allCaptures, pendingCount } from '../lib/queue'

type CheckStatus = 'pending' | 'ok' | 'fail'
interface Check {
  id: string
  label: string
  status: CheckStatus
  detail?: string
}

const STABLE_JOB_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const STABLE_JOB_SLUG = 'sy6-assets'

export function DebugPage() {
  const [checks, setChecks] = useState<Check[]>([
    { id: 'config', label: 'Runtime config loaded', status: 'pending' },
    { id: 'connectivity', label: 'Supabase reachable', status: 'pending' },
    { id: 'schema', label: 'Schema deployed (classifications table)', status: 'pending' },
    { id: 'fields', label: 'Classification fields seeded', status: 'pending' },
    { id: 'job', label: 'SY6 BREAKER job exists', status: 'pending' },
    { id: 'assets', label: 'SY6 assets loaded (expect 101)', status: 'pending' },
    { id: 'captures', label: 'Captures table writable (non-destructive)', status: 'pending' },
  ])
  const [running, setRunning] = useState(false)

  const update = (id: string, patch: Partial<Check>) => {
    setChecks((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const runChecks = async () => {
    setRunning(true)
    // Reset
    setChecks((cs) => cs.map((c) => ({ ...c, status: 'pending' as const, detail: undefined })))

    // 1. Config
    const cfg = window.__EQ_CONFIG__ ?? {}
    const url = cfg.supabaseUrl || ''
    const key = cfg.supabaseAnonKey || ''
    if (!url || !key || key === 'REPLACE_ME_WITH_ANON_KEY') {
      update('config', {
        status: 'fail',
        detail: 'config.js is missing or still has the placeholder anon key. Edit /config.js on the deployed site.',
      })
      setRunning(false)
      return
    }
    update('config', {
      status: 'ok',
      detail: `URL: ${url}\nKey: ${key.slice(0, 12)}…${key.slice(-6)}`,
    })

    // 2. Connectivity — cheap head request
    try {
      const { error } = await supabase.from('classifications').select('code', { count: 'exact', head: true })
      if (error) throw error
      update('connectivity', { status: 'ok', detail: 'HTTP reachable' })
    } catch (err: any) {
      update('connectivity', { status: 'fail', detail: err?.message ?? String(err) })
      setRunning(false)
      return
    }

    // 3. Schema — count classifications
    const { data: classData, error: classErr } = await supabase
      .from('classifications')
      .select('code')
    if (classErr || !classData) {
      update('schema', { status: 'fail', detail: classErr?.message ?? 'No rows returned' })
    } else {
      update('schema', { status: 'ok', detail: `${classData.length} classifications` })
    }

    // 4. Fields
    const { data: fieldData, error: fieldErr } = await supabase
      .from('classification_fields')
      .select('id', { count: 'exact', head: true })
    if (fieldErr) {
      update('fields', { status: 'fail', detail: fieldErr.message })
    } else {
      // head:true returns count only via the count option
      const { count } = await supabase
        .from('classification_fields')
        .select('*', { count: 'exact', head: true })
      update('fields', { status: 'ok', detail: `${count ?? '?'} field rows` })
    }

    // 5. Job
    const jobResp = await supabase
      .from('jobs')
      .select('*')
      .eq('id', STABLE_JOB_ID)
      .maybeSingle()
    const jobErr = jobResp.error
    const job = jobResp.data as { name: string | null; site_code: string; classification_code: string } | null
    if (jobErr || !job) {
      update('job', {
        status: 'fail',
        detail: jobErr?.message ?? 'SY6 BREAKER job not found. Did you run setup.sql?',
      })
    } else {
      update('job', { status: 'ok', detail: `${job.name} (${job.site_code} · ${job.classification_code})` })
    }

    // 6. Assets
    const assetsResp = await supabase
      .from('assets')
      .select('id, description')
      .eq('job_id', STABLE_JOB_ID)
    const assetsErr = assetsResp.error
    const assetsData = (assetsResp.data as Array<{ id: string; description: string }> | null) ?? null
    if (assetsErr) {
      update('assets', { status: 'fail', detail: assetsErr.message })
    } else {
      const n = assetsData?.length ?? 0
      update('assets', {
        status: n === 101 ? 'ok' : 'fail',
        detail: `${n} assets (expected 101)`,
      })
    }

    // 7. Captures — write a test row then delete it
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
          // Clean up — match by the probe value so we don't nuke real data
          await supabase
            .from('captures')
            .delete()
            .eq('asset_id', testAssetId)
            .eq('classification_field_id', testFieldId)
            .eq('value', '__DEBUG_PROBE__')
          update('captures', { status: 'ok', detail: 'Probe write/delete OK' })
        }
      } else {
        update('captures', { status: 'fail', detail: 'No BREAKER fields — cannot probe' })
      }
    } else {
      update('captures', { status: 'fail', detail: 'No assets to probe against' })
    }

    setRunning(false)
  }

  useEffect(() => {
    void runChecks()
  }, [])

  const allOk = checks.every((c) => c.status === 'ok')
  const anyFail = checks.some((c) => c.status === 'fail')

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="Self-check" subtitle="Deploy diagnostic" onBack={() => navigate('/')} />
      <div className="flex-1 px-4 pt-4 pb-6 space-y-4 safe-bottom">
        <div
          className={`card p-4 ${
            anyFail ? 'border-bad/40 bg-bad/5' : allOk ? 'border-ok/40 bg-ok/5' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="text-2xl">{running ? '⏳' : allOk ? '✅' : anyFail ? '❌' : '…'}</div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-ink">
                {running ? 'Running checks…' : allOk ? 'All systems go' : anyFail ? 'Something needs attention' : 'Idle'}
              </div>
              <div className="text-xs text-muted">
                {running ? 'Usually takes 2–3 seconds' : 'Last run just now'}
              </div>
            </div>
            <button onClick={runChecks} disabled={running} className="btn btn-ghost btn-md">
              Rerun
            </button>
          </div>
        </div>

        <div className="card divide-y divide-border/60">
          {checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </div>

        <div className="card p-4">
          <h2 className="font-bold text-ink mb-2">Local state</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Online</div>
              <div>{navigator.onLine ? '✓ yes' : '— offline'}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">User agent</div>
              <div className="text-xs mono truncate" title={navigator.userAgent}>
                {navigator.userAgent.slice(0, 40)}…
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Local captures</div>
              <div className="mono">{allCaptures().length} total</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Pending sync</div>
              <div className="mono">{pendingCount()}</div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-bold text-ink mb-2">Quick links</h2>
          <div className="grid grid-cols-1 gap-2 text-sm">
            <button
              onClick={() => navigate(`/j/${STABLE_JOB_SLUG}`)}
              className="btn btn-ghost btn-md w-full justify-start"
            >
              Open SY6 BREAKER job →
            </button>
            <button
              onClick={() => navigate(`/j/${STABLE_JOB_SLUG}/admin`)}
              className="btn btn-ghost btn-md w-full justify-start"
            >
              Admin view →
            </button>
            <button
              onClick={() => navigate(`/j/${STABLE_JOB_SLUG}/export`)}
              className="btn btn-ghost btn-md w-full justify-start"
            >
              Export →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckRow({ check }: { check: Check }) {
  const icon = check.status === 'ok' ? '✓' : check.status === 'fail' ? '✕' : '○'
  const colour =
    check.status === 'ok'
      ? 'text-ok bg-ok/10 border-ok/20'
      : check.status === 'fail'
        ? 'text-bad bg-bad/10 border-bad/20'
        : 'text-muted bg-border/30 border-border'
  return (
    <div className="p-4 flex items-start gap-3">
      <div
        className={`w-7 h-7 rounded-full border flex items-center justify-center font-bold text-sm shrink-0 ${colour}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-ink text-sm">{check.label}</div>
        {check.detail ? (
          <div className="text-xs text-muted mono mt-1 whitespace-pre-wrap break-all">{check.detail}</div>
        ) : null}
      </div>
    </div>
  )
}
