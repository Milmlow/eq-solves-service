import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { AttachmentList } from '@/components/ui/AttachmentList'
import { DefectDetailForm } from './DefectDetailForm'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import { formatDate } from '@/lib/utils/format'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Role, Attachment } from '@/lib/types'

/**
 * S-W2-1 — Defect detail page. A shareable, deep-linkable record for a
 * single defect: metadata, links back to the asset / site / originating
 * check, an editable status/assignment/work-order block, and a photo
 * evidence list (camera-capture enabled, customer-report grade).
 *
 * Defects use status (open/resolved) — never is_active (see CLAUDE.md
 * soft-delete note). The transactional defect-alert email links here.
 */

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-sky-100 text-sky-700',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-eq-grey',
}

const STATUS_ACCENT: Record<string, string> = {
  open: 'bg-red-500',
  in_progress: 'bg-amber-500',
  resolved: 'bg-green-500',
  closed: 'bg-gray-400',
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export default async function DefectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

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

  // Defect + relations. RLS scopes to the user's tenant.
  const { data: defect, error } = await supabase
    .from('defects')
    .select(`
      id, title, description, severity, status,
      work_order_number, work_order_date,
      raised_by, assigned_to, resolved_at, resolved_by, resolution_notes,
      created_at, updated_at, asset_id, site_id,
      assets(id, name),
      sites(id, name),
      maintenance_checks(id, custom_name)
    `)
    .eq('id', id)
    .maybeSingle()

  if (error || !defect) notFound()

  const asset = one(defect.assets as { id: string; name: string } | null)
  const site = one(defect.sites as { id: string; name: string } | null)
  const check = one(defect.maintenance_checks as { id: string; custom_name: string | null } | null)

  // Resolve raised_by / assigned_to / resolved_by display names + the team
  // list for the assignment dropdown. One profiles round-trip.
  const { data: members } = await supabase
    .from('tenant_members')
    .select('user_id')
    .eq('is_active', true)
  const memberIds = (members ?? []).map((m) => m.user_id as string)
  const team: { id: string; name: string }[] = []
  const nameById = new Map<string, string>()
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', memberIds)
    for (const p of profiles ?? []) {
      const name = p.full_name ?? p.email ?? 'Unknown'
      nameById.set(p.id, name)
      team.push({ id: p.id, name })
    }
  }
  // raised_by / resolved_by may not be tenant_members anymore — fetch any
  // missing names directly so the metadata still resolves.
  const extraIds = [defect.raised_by, defect.resolved_by, defect.assigned_to]
    .filter((x): x is string => Boolean(x) && !nameById.has(x as string))
  if (extraIds.length > 0) {
    const { data: extra } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', extraIds)
    for (const p of extra ?? []) nameById.set(p.id, p.full_name ?? p.email ?? 'Unknown')
  }

  // Photo / evidence attachments for this defect.
  const { data: attachments } = await supabase
    .from('attachments')
    .select('*')
    .eq('entity_type', 'defect')
    .eq('entity_id', id)
    .order('created_at')

  // Edit gate: writers can edit any defect; a technician can edit one
  // assigned to them. The server action re-checks — this only drives UI.
  const canEdit = canWrite(userRole) || (!!user && defect.assigned_to === user.id)
  const accent = STATUS_ACCENT[defect.status] ?? 'bg-eq-sky'

  return (
    <div className="space-y-4">
      <div className={`-mx-4 lg:-mx-8 -mt-4 lg:-mt-8 mb-2 h-1 ${accent}`} aria-hidden />
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Defects', href: '/defects' },
          { label: defect.title },
        ]} />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <h1 className="text-3xl font-bold text-eq-ink tracking-tight">{defect.title}</h1>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${SEVERITY_STYLES[defect.severity] ?? 'bg-gray-100 text-gray-600'}`}>
            {defect.severity}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${STATUS_STYLES[defect.status] ?? STATUS_STYLES.open}`}>
            {defect.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-sm text-eq-grey mt-1">
          {asset?.name ?? '—'}
          {site?.name ? <span> · {site.name}</span> : null}
          <span> · raised {formatDate(defect.created_at)}</span>
        </p>
      </div>

      {/* Description + linkage */}
      <Card>
        {defect.description ? (
          <div className="mb-4">
            <p className="text-xs font-bold text-eq-grey uppercase mb-1">Description</p>
            <p className="text-sm text-eq-ink whitespace-pre-wrap">{defect.description}</p>
          </div>
        ) : (
          <p className="text-sm text-eq-grey mb-4">No description.</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Asset</p>
            {asset ? (
              <Link href={`/assets/${asset.id}`} className="text-eq-sky hover:text-eq-deep transition-colors">{asset.name}</Link>
            ) : <p className="text-eq-ink mt-0.5">—</p>}
          </div>
          <div>
            <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">From check</p>
            {check ? (
              <Link href={`/maintenance/${check.id}`} className="text-eq-sky hover:text-eq-deep transition-colors">{check.custom_name ?? 'Maintenance check'}</Link>
            ) : <p className="text-eq-ink mt-0.5">—</p>}
          </div>
          <div>
            <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Raised by</p>
            <p className="text-eq-ink mt-0.5">{defect.raised_by ? (nameById.get(defect.raised_by) ?? '—') : '—'}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Assigned to</p>
            <p className="text-eq-ink mt-0.5">{defect.assigned_to ? (nameById.get(defect.assigned_to) ?? '—') : 'Unassigned'}</p>
          </div>
          {defect.work_order_number && (
            <div>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Work order</p>
              <p className="text-eq-ink mt-0.5">{defect.work_order_number}{defect.work_order_date ? ` · ${formatDate(defect.work_order_date)}` : ''}</p>
            </div>
          )}
          {defect.resolved_at && (
            <div>
              <p className="text-[11px] font-bold text-eq-grey uppercase tracking-wide">Resolved</p>
              <p className="text-eq-ink mt-0.5">{formatDate(defect.resolved_at)}{defect.resolved_by ? ` · ${nameById.get(defect.resolved_by) ?? ''}` : ''}</p>
            </div>
          )}
        </div>

        {/* Read-only resolution note for viewers who can't edit. */}
        {defect.resolution_notes && !canEdit && (
          <div className="mt-4">
            <p className="text-xs font-bold text-eq-grey uppercase mb-1">Resolution</p>
            <p className="text-sm text-eq-ink whitespace-pre-wrap">{defect.resolution_notes}</p>
          </div>
        )}
      </Card>

      {/* Editable block */}
      {canEdit && (
        <Card>
          <h2 className="text-sm font-bold text-eq-ink mb-3">Update defect</h2>
          <DefectDetailForm
            defectId={id}
            initial={{
              status: defect.status,
              assigned_to: defect.assigned_to,
              work_order_number: defect.work_order_number,
              work_order_date: defect.work_order_date,
              resolution_notes: defect.resolution_notes,
            }}
            team={team}
            canEdit={canEdit}
          />
        </Card>
      )}

      {/* Photo evidence — camera-capture enabled, shown on PDF reports. */}
      <Card>
        <AttachmentList
          entityType="defect"
          entityId={id}
          attachments={(attachments ?? []) as Attachment[]}
          canWrite={canEdit}
          isAdmin={isAdmin(userRole)}
        />
      </Card>
    </div>
  )
}
