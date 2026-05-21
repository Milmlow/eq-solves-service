/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /admin/activity — live "what's happening right now" feed.
 *
 * Reads audit_logs and renders a friendly drip of the last 100 events,
 * newest first. Designed to be mounted on a wall display during the
 * onboarding day / customer reviews so execs and customers can watch
 * the team in action.
 *
 * Refreshes every 15 seconds via Next's revalidate. No client-side
 * polling so the page works on locked-down kiosk browsers without JS
 * fetch quirks.
 *
 * Page-level role gate matches existing /admin/* behaviour — the URL
 * is reachable by anyone signed in, but the data is RLS-scoped to the
 * caller's tenant, and the sidebar entry on /admin is admin-only.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/server'
import {
  ClipboardCheck,
  Zap,
  Activity,
  AlertTriangle,
  Upload,
  Plus,
  CheckCircle2,
  Pencil,
  Trash2,
  LogIn,
  FileText,
  Sparkles,
} from 'lucide-react'

export const dynamic = 'force-dynamic'
export const revalidate = 15

type AuditRow = {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
}

/**
 * Human-friendly "X ago" for the live feed. Resolution to the second
 * for recent rows so the drip feels alive; rolls up to minutes / hours /
 * days as items age. Locale-independent — built from numbers not
 * Intl.RelativeTimeFormat because the latter has stable formatting but
 * pluralisation drift across browsers.
 */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (isNaN(diffMs)) return iso
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  // Older than a week — just show the date so the wall display doesn't
  // shout "30d ago" at an exec.
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

/**
 * Per-entity icon + colour palette so the wall display reads at a
 * glance: green for completes, blue for starts, amber for defects,
 * purple for imports, etc. Falls back to a neutral grey for entity
 * types we don't have a specific look for yet.
 */
type Tone = {
  icon: typeof Activity
  /** Background colour for the icon chip. */
  bg: string
  /** Foreground / icon colour. */
  fg: string
}
function toneFor(action: string, entityType: string): Tone {
  // Action takes precedence over entity for the most semantically
  // useful events (complete, defect raised, etc.).
  if (action === 'create' && entityType === 'defect') {
    return { icon: AlertTriangle, bg: 'bg-amber-50', fg: 'text-amber-700' }
  }
  if (action === 'create' && entityType === 'maintenance_check') {
    return { icon: ClipboardCheck, bg: 'bg-sky-50', fg: 'text-sky-700' }
  }
  if (action === 'update' && entityType === 'maintenance_check') {
    return { icon: ClipboardCheck, bg: 'bg-blue-50', fg: 'text-blue-700' }
  }
  if (action === 'create' && entityType === 'rcd_test') {
    return { icon: Zap, bg: 'bg-violet-50', fg: 'text-violet-700' }
  }
  if (action === 'create' && entityType === 'acb_test') {
    return { icon: Zap, bg: 'bg-indigo-50', fg: 'text-indigo-700' }
  }
  if (action === 'import') {
    return { icon: Upload, bg: 'bg-purple-50', fg: 'text-purple-700' }
  }
  if (action === 'create') {
    return { icon: Plus, bg: 'bg-emerald-50', fg: 'text-emerald-700' }
  }
  if (action === 'update') {
    return { icon: Pencil, bg: 'bg-slate-50', fg: 'text-slate-700' }
  }
  if (action === 'delete') {
    return { icon: Trash2, bg: 'bg-red-50', fg: 'text-red-700' }
  }
  if (entityType === 'auth' || action === 'login') {
    return { icon: LogIn, bg: 'bg-gray-50', fg: 'text-gray-700' }
  }
  return { icon: Activity, bg: 'bg-gray-50', fg: 'text-gray-700' }
}

/**
 * Render a friendlier entity-type label for the chip on each row.
 * Falls back to the raw column when we don't have a friendly form.
 */
function entityLabel(entityType: string): string {
  const map: Record<string, string> = {
    maintenance_check: 'Check',
    maintenance_check_item: 'Task',
    check_asset: 'Asset on check',
    acb_test: 'ACB test',
    nsx_test: 'NSX test',
    rcd_test: 'RCD test',
    defect: 'Defect',
    customer: 'Customer',
    site: 'Site',
    asset: 'Asset',
    contract_scope: 'Scope',
    contract_variation: 'Variation',
    attachment: 'Attachment',
    import_session: 'Import',
    profile: 'User',
  }
  return map[entityType] ?? entityType
}

export default async function ActivityFeedPage() {
  const supabase = await createClient()

  // Pull a generous window — 200 rows, filtered to entity types worth
  // surfacing on a wall display. Settings / cron / internal-only writes
  // are uninteresting in the live drip.
  const { data: rowsRaw } = await supabase
    .from('audit_logs')
    .select('id, user_id, action, entity_type, entity_id, summary, metadata, created_at')
    .in('entity_type', [
      'maintenance_check',
      'maintenance_check_item',
      'check_asset',
      'acb_test',
      'nsx_test',
      'rcd_test',
      'defect',
      'customer',
      'site',
      'asset',
      'contract_scope',
      'contract_variation',
      'attachment',
      'import_session',
    ])
    .order('created_at', { ascending: false })
    .limit(100)
  const rows: AuditRow[] = (rowsRaw ?? []) as AuditRow[]

  // Resolve user names — display "Royce" not a uuid.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((v): v is string => v !== null)))
  const { data: profilesRaw } = userIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [] as ProfileRow[] }
  const profileById = new Map<string, ProfileRow>(
    (profilesRaw ?? []).map((p) => [p.id, p]),
  )

  function displayName(userId: string | null): string {
    if (!userId) return 'system'
    const p = profileById.get(userId)
    if (!p) return 'someone'
    // Prefer first name for the wall display ("Royce completed…" reads
    // better than "Royce Milmlow completed…"). Falls back to email
    // local-part, then truncated uuid.
    if (p.full_name) return p.full_name.split(' ')[0] ?? p.full_name
    if (p.email) return p.email.split('@')[0] ?? p.email
    return userId.slice(0, 8)
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Admin', href: '/admin' },
          { label: 'Activity' },
        ]} />
        <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-eq-ink">Activity</h1>
            <p className="text-sm text-eq-grey mt-1">
              The last 100 things that happened across the workspace. Refreshes every 15 seconds.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>

      <Card>
        <div className="p-2 sm:p-4">
          {rows.length === 0 ? (
            <div className="py-12 text-center">
              <Sparkles className="w-6 h-6 text-eq-grey mx-auto mb-2" />
              <p className="text-sm text-eq-grey">Nothing happening yet. Once techs start checks, the feed will fill up.</p>
            </div>
          ) : (
            <ol className="space-y-2">
              {rows.map((row) => {
                const tone = toneFor(row.action, row.entity_type)
                const Icon = tone.icon
                const who = displayName(row.user_id)
                const what = row.summary ?? `${row.action} ${row.entity_type}`
                const where =
                  row.entity_type === 'maintenance_check' && row.entity_id
                    ? `/maintenance/${row.entity_id}`
                    : null
                const RowWrapper = where ? Link : 'div'
                const wrapperProps = where ? { href: where } : {}
                return (
                  <li key={row.id}>
                    <RowWrapper
                      {...(wrapperProps as { href: string })}
                      className={
                        'flex items-start gap-3 p-3 rounded-lg border border-eq-line bg-white ' +
                        (where ? 'hover:bg-eq-ice/30 transition-colors cursor-pointer' : '')
                      }
                    >
                      <div className={`w-9 h-9 rounded-md ${tone.bg} ${tone.fg} flex items-center justify-center shrink-0`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-eq-ink leading-snug">
                          <span className="font-semibold">{who}</span>
                          {' · '}
                          <span>{what}</span>
                        </p>
                        <p className="text-xs text-eq-grey mt-0.5 flex items-center gap-2">
                          <span>{timeAgo(row.created_at)}</span>
                          <span className="text-gray-300">·</span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-eq-deep bg-eq-ice px-1.5 py-0.5 rounded">
                            {entityLabel(row.entity_type)}
                          </span>
                        </p>
                      </div>
                    </RowWrapper>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </Card>

      <p className="text-xs text-eq-grey text-center">
        Looking for imports specifically? <Link href="/admin/imports" className="text-eq-deep underline">/admin/imports</Link> has the import-only feed.
        Older history lives on the <Link href="/audit-log" className="text-eq-deep underline">full audit log</Link>.
      </p>
    </div>
  )
}

// Helper to silence the unused-import warnings for icons that may only
// fire in `toneFor` under specific entity types. Keeps the tone mapping
// readable without per-icon eslint disable comments.
const _ICON_IMPORTS_PIN = [FileText, CheckCircle2] as const
void _ICON_IMPORTS_PIN
