import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { KindPill } from '@/components/ui/KindPill'
import { AttachmentList } from '@/components/ui/AttachmentList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { formatDate } from '@/lib/utils/format'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Gauge, ClipboardCheck, Wrench } from 'lucide-react'
import type { Role, Attachment } from '@/lib/types'

/**
 * S-W2-4 — Asset detail page. Read-only aggregation that answers "what is
 * the full history for this asset?": metadata, recent maintenance checks,
 * linked ACB/NSX/RCD tests, open defects, attachments, and calibration
 * context. All source data already exists — this page joins it. No schema
 * change. Prerequisite for QR-label scanning (a scan resolves to this URL).
 */

const CHECK_STATUS_BADGE: Record<string, import('@eq-solutions/ui').StatusKind> = {
  scheduled: 'open',
  in_progress: 'in-progress',
  complete: 'closed',
  overdue: 'overdue',
  cancelled: 'await',
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-sky-100 text-sky-700',
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Current user + role (drives attachment write/delete affordances).
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Asset + its site + job plan. RLS scopes to the user's tenant.
  const { data: asset, error } = await supabase
    .from('assets')
    .select(`
      *,
      sites(id, name, code, customers(id, name)),
      job_plans(id, name, code, type)
    `)
    .eq('id', id)
    .maybeSingle()

  if (error || !asset) notFound()

  const site = one(asset.sites as { id: string; name: string; code: string | null; customers: unknown } | null)
  const customer = one(site?.customers as { id: string; name: string } | null | undefined)
  const jobPlan = one(asset.job_plans as { id: string; name: string; code: string | null; type: string | null } | null)

  // Parallel pulls for the history sections. Each is independently RLS-scoped.
  const [
    { data: checkAssets },
    { data: acbTests },
    { data: nsxTests },
    { data: rcdTests },
    { data: openDefects },
    { data: attachments },
    { data: instrumentRow },
  ] = await Promise.all([
    // Recent maintenance checks this asset appeared in (via check_assets).
    supabase
      .from('check_assets')
      .select('id, status, completed_at, check_id, maintenance_checks(id, custom_name, kind, status, due_date, completed_at, job_plans(name))')
      .eq('asset_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('acb_tests')
      .select('id, test_date, overall_result, step3_status, check_id')
      .eq('asset_id', id)
      .eq('is_active', true)
      .order('test_date', { ascending: false })
      .limit(10),
    supabase
      .from('nsx_tests')
      .select('id, test_date, overall_result, step3_status, check_id')
      .eq('asset_id', id)
      .eq('is_active', true)
      .order('test_date', { ascending: false })
      .limit(10),
    supabase
      .from('rcd_tests')
      .select('id, test_date, status, check_id')
      .eq('asset_id', id)
      .eq('is_active', true)
      .order('test_date', { ascending: false })
      .limit(10),
    supabase
      .from('defects')
      .select('id, title, severity, status, created_at, work_order_number')
      .eq('asset_id', id)
      .in('status', ['open', 'in_progress'])
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'asset')
      .eq('entity_id', id)
      .order('created_at'),
    // Calibration context — an instrument register row sharing this asset's
    // tag, if any. Most assets aren't instruments; renders nothing when null.
    supabase
      .from('instruments')
      .select('id, name, calibration_date, calibration_due, status')
      .eq('asset_tag', (asset.maximo_id as string | null) ?? '__none__')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  type CheckRel = {
    id: string; custom_name: string | null; kind: string | null
    status: string; due_date: string | null; completed_at: string | null
    job_plans: { name: string } | { name: string }[] | null
  }
  type CheckAssetRow = {
    id: string
    status: string
    completed_at: string | null
    check_id: string
    maintenance_checks: CheckRel | CheckRel[] | null
  }
  const recentChecks: CheckRel[] = ((checkAssets ?? []) as CheckAssetRow[])
    .map((ca) => one(ca.maintenance_checks))
    .filter((c): c is CheckRel => c !== null)
    .slice(0, 3)

  const acb = (acbTests ?? []) as Array<{ id: string; test_date: string; overall_result: string; step3_status: string; check_id: string | null }>
  const nsx = (nsxTests ?? []) as Array<{ id: string; test_date: string; overall_result: string; step3_status: string; check_id: string | null }>
  const rcd = (rcdTests ?? []) as Array<{ id: string; test_date: string; status: string; check_id: string | null }>
  const defects = (openDefects ?? []) as Array<{ id: string; title: string; severity: string; status: string; created_at: string; work_order_number: string | null }>
  const instrument = instrumentRow as { id: string; name: string; calibration_date: string | null; calibration_due: string | null; status: string } | null

  const todayStr = new Date().toISOString().slice(0, 10)
  const calOverdue = !!instrument?.calibration_due && instrument.calibration_due < todayStr

  // Metadata grid — only show fields that carry a value.
  const meta: Array<{ label: string; value: string | null }> = [
    { label: 'Type', value: asset.asset_type as string },
    { label: 'Manufacturer', value: (asset.manufacturer as string | null) },
    { label: 'Model', value: (asset.model as string | null) },
    { label: 'Serial', value: (asset.serial_number as string | null) },
    { label: 'Maximo ID', value: (asset.maximo_id as string | null) },
    { label: 'Jemena ID', value: (asset.jemena_asset_id as string | null) },
    { label: 'Location', value: (asset.location as string | null) },
    { label: 'Building', value: (asset.building as string | null) },
    { label: 'Zone', value: (asset.block_or_zone as string | null) },
    { label: 'Install date', value: asset.install_date ? formatDate(asset.install_date as string) : null },
    { label: 'Commissioned', value: asset.commissioned_date ? formatDate(asset.commissioned_date as string) : null },
    { label: 'Maintenance plan', value: jobPlan ? [jobPlan.name, jobPlan.type].filter(Boolean).join(' — ') : null },
  ].filter((m) => m.value)

  const assetActive = asset.is_active as boolean

  return (
    <div className="space-y-4">
      <div className={`-mx-4 lg:-mx-8 -mt-4 lg:-mt-8 mb-2 h-1 ${assetActive ? 'bg-eq-sky' : 'bg-gray-400'}`} aria-hidden />
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Assets', href: '/assets' },
          { label: asset.name as string },
        ]} />
        <div className="flex items-center gap-3 mt-3">
          <h1 className="text-3xl font-bold text-eq-ink tracking-tight">{asset.name as string}</h1>
          {!assetActive && <StatusBadge status="await" label="Archived" />}
        </div>
        <p className="text-sm text-eq-grey mt-1">
          {customer?.name ? `${customer.name} · ` : ''}
          {site?.name ?? '—'}
          {asset.asset_type ? <span> · {asset.asset_type as string}</span> : null}
        </p>
      </div>

      {/* Metadata */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-4 flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-eq-grey" /> Asset details
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {meta.map((m) => (
            <div key={m.label}>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">{m.label}</p>
              <p className="text-sm text-eq-ink mt-0.5 break-words">{m.value}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Open defects */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-4 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-eq-grey" /> Open defects ({defects.length})
        </h2>
        {defects.length === 0 ? (
          <p className="text-sm text-eq-grey">No open defects on this asset.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {defects.map((d) => (
              <Link
                key={d.id}
                href={`/defects/${d.id}`}
                className="flex items-center justify-between gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm text-eq-ink min-w-0 truncate">{d.title}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {d.work_order_number && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">WO {d.work_order_number}</span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${SEVERITY_STYLES[d.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                    {d.severity}
                  </span>
                  <span className="text-xs text-eq-grey">{formatDate(d.created_at)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Recent maintenance checks */}
      <Card>
        <h2 className="text-sm font-bold text-eq-ink mb-4 flex items-center gap-1.5">
          <ClipboardCheck className="w-4 h-4 text-eq-grey" /> Recent maintenance checks
        </h2>
        {recentChecks.length === 0 ? (
          <p className="text-sm text-eq-grey">This asset hasn&apos;t appeared in any maintenance checks yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentChecks.map((c) => {
              const jp = one(c.job_plans)
              const name = c.custom_name ?? jp?.name ?? 'Maintenance check'
              const badge = CHECK_STATUS_BADGE[c.status] ?? 'open'
              return (
                <Link
                  key={c.id}
                  href={`/maintenance/${c.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <KindPill kind={c.kind ?? 'maintenance'} />
                    <span className="text-sm text-eq-ink truncate">{name}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={badge} />
                    <span className="text-xs text-eq-grey">
                      {c.completed_at ? formatDate(c.completed_at) : c.due_date ? `Due ${formatDate(c.due_date)}` : ''}
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      {/* Linked tests */}
      {(acb.length > 0 || nsx.length > 0 || rcd.length > 0) && (
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4 flex items-center gap-1.5">
            <Gauge className="w-4 h-4 text-eq-grey" /> Test history
          </h2>
          <div className="space-y-2">
            {acb.map((t) => (
              <Link key={`acb-${t.id}`} href={`/testing/acb/${t.id}`} className="flex items-center justify-between gap-3 py-2 px-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                <span className="flex items-center gap-2"><KindPill kind="acb" /><span className="text-sm text-eq-ink">ACB test</span></span>
                <span className="flex items-center gap-2 text-xs text-eq-grey">
                  <span className={t.overall_result === 'Pass' ? 'text-green-600 font-medium' : t.overall_result === 'Fail' ? 'text-red-600 font-medium' : ''}>{t.overall_result || '—'}</span>
                  <span>· {formatDate(t.test_date)}</span>
                </span>
              </Link>
            ))}
            {nsx.map((t) => (
              <Link key={`nsx-${t.id}`} href={`/testing/nsx/${t.id}`} className="flex items-center justify-between gap-3 py-2 px-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                <span className="flex items-center gap-2"><KindPill kind="nsx" /><span className="text-sm text-eq-ink">NSX test</span></span>
                <span className="flex items-center gap-2 text-xs text-eq-grey">
                  <span className={t.overall_result === 'Pass' ? 'text-green-600 font-medium' : t.overall_result === 'Fail' ? 'text-red-600 font-medium' : ''}>{t.overall_result || '—'}</span>
                  <span>· {formatDate(t.test_date)}</span>
                </span>
              </Link>
            ))}
            {rcd.map((t) => (
              <Link key={`rcd-${t.id}`} href={`/testing/rcd/${t.id}`} className="flex items-center justify-between gap-3 py-2 px-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                <span className="flex items-center gap-2"><KindPill kind="rcd" /><span className="text-sm text-eq-ink">RCD test</span></span>
                <span className="text-xs text-eq-grey">{formatDate(t.test_date)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Calibration — only when this asset tag maps to an instrument. */}
      {instrument && (
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-4 flex items-center gap-1.5">
            <Gauge className="w-4 h-4 text-eq-grey" /> Calibration
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Instrument</p>
              <p className="text-sm text-eq-ink mt-0.5">{instrument.name}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Last calibrated</p>
              <p className="text-sm text-eq-ink mt-0.5">{instrument.calibration_date ? formatDate(instrument.calibration_date) : '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Calibration due</p>
              <p className={`text-sm mt-0.5 ${calOverdue ? 'text-red-600 font-medium' : 'text-eq-ink'}`}>
                {instrument.calibration_due ? formatDate(instrument.calibration_due) : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Status</p>
              <p className="text-sm text-eq-ink mt-0.5">{instrument.status}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Attachments — reference docs (SLDs, manuals) pinned to the asset. */}
      <Card>
        <AttachmentList
          entityType="asset"
          entityId={id}
          attachments={(attachments ?? []) as Attachment[]}
          canWrite={canWrite(userRole)}
          isAdmin={isAdmin(userRole)}
        />
      </Card>
    </div>
  )
}
