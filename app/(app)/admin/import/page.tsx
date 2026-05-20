/**
 * Admin canonical Delta WO importer.
 *
 * Distinct from the supervisor-grade wizard at /maintenance/import — this
 * one validates every projected maintenance_check / check_asset against
 * the canonical JSON Schemas (ajv) before allowing a commit, and is
 * gated to admin role only. The eq-solves-intake schemas are the source
 * of truth (mirrored under `lib/import/schemas/`).
 */
import { redirect } from 'next/navigation'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { CanonicalImportWizard } from './CanonicalImportWizard'

export const dynamic = 'force-dynamic'

export default async function AdminCanonicalImportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const role = (membership?.role as Role) ?? null
  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Home', href: '/dashboard' },
        { label: 'Admin', href: '/admin' },
        { label: 'Canonical Import' },
      ]}
    />
  )

  if (!isAdmin(role)) {
    return (
      <div className="space-y-6">
        {breadcrumb}
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Canonical Delta Import</h1>
        <p className="text-sm text-eq-grey">
          Admin role required. The canonical importer validates every imported row against the
          published canonical schemas before writing to the database — admin-only because it
          bypasses the resolution UI the supervisor-grade wizard uses.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        {breadcrumb}
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Canonical Delta Import</h1>
        <p className="text-sm text-eq-grey mt-1 max-w-3xl">
          Upload the monthly Equinix Maximo <strong>Delta</strong> work-order spreadsheet
          (<code>.xlsx</code>). Every row is projected to the canonical{' '}
          <code>maintenance_check</code> + <code>check_asset</code> shape and validated against
          the published JSON Schemas before commit. Sites, job plans, and assets must already
          exist under this tenant — unresolved rows block the whole upload (use the supervisor
          wizard at <code>/maintenance/import</code> for inline resolution).
        </p>
      </div>
      <CanonicalImportWizard />
    </div>
  )
}
