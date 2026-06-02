'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { RefreshCw, CheckCircle2, AlertCircle, Link2, CloudUpload } from 'lucide-react'
import { syncSitesFromFieldAction, backfillCanonicalAction, type BackfillResult } from './actions'

type SyncResult =
  | { success: true; created: number; updated: number; message?: string }
  | { success: false; error: string }

interface Props {
  fieldConfigured: boolean
  totalSites: number
  syncedSites: number
  totalCustomers: number
  canonicalCustomers: number
  canonicalSites: number
}

export function IntegrationsClient({
  fieldConfigured,
  totalSites,
  syncedSites,
  totalCustomers,
  canonicalCustomers,
  canonicalSites,
}: Props) {
  return (
    <div className="space-y-4">
      <FieldSyncCard
        fieldConfigured={fieldConfigured}
        totalSites={totalSites}
        syncedSites={syncedSites}
      />
      <CanonicalSyncCard
        totalCustomers={totalCustomers}
        canonicalCustomers={canonicalCustomers}
        totalSites={totalSites}
        canonicalSites={canonicalSites}
      />
    </div>
  )
}

function CanonicalSyncCard({
  totalCustomers,
  canonicalCustomers,
  totalSites,
  canonicalSites,
}: {
  totalCustomers: number
  canonicalCustomers: number
  totalSites: number
  canonicalSites: number
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<BackfillResult | { success: false; error: string } | null>(null)

  // Optimistic counts — bump after a successful back-fill so bars update
  // without a full reload (revalidatePath handles the server state separately).
  const [localCanonicalCustomers, setLocalCanonicalCustomers] = useState(canonicalCustomers)
  const [localCanonicalSites, setLocalCanonicalSites] = useState(canonicalSites)

  const customerPct = totalCustomers > 0 ? Math.round((localCanonicalCustomers / totalCustomers) * 100) : 0
  const sitePct     = totalSites     > 0 ? Math.round((localCanonicalSites     / totalSites)     * 100) : 0
  const allSynced   = localCanonicalCustomers >= totalCustomers && localCanonicalSites >= totalSites && totalCustomers > 0
  const hasGap      = localCanonicalCustomers < totalCustomers || localCanonicalSites < totalSites

  function handleBackfill() {
    setResult(null)
    startTransition(async () => {
      const res = await backfillCanonicalAction()
      setResult(res)
      if (res.success) {
        setLocalCanonicalCustomers((prev) => Math.min(prev + res.customers.synced, totalCustomers))
        setLocalCanonicalSites((prev) => Math.min(prev + res.sites.synced, totalSites))
      }
    })
  }

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-eq-ice flex items-center justify-center text-eq-deep flex-shrink-0">
          <CloudUpload className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-eq-ink">Canonical API</h2>
            {allSynced ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                All synced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-eq-grey bg-gray-100 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                Write-through active
              </span>
            )}
          </div>

          <p className="text-xs text-eq-grey mb-3">
            Customers and sites are pushed to the EQ canonical store whenever they are
            created or updated. The coverage below shows how many records have a confirmed
            canonical ID. Run a back-fill to sync existing records created before this
            integration was active.
          </p>

          {(totalCustomers > 0 || totalSites > 0) && (
            <div className="space-y-3 mb-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
              {/* Customers */}
              {totalCustomers > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-eq-ink">Customers synced</span>
                    <span className="text-xs font-semibold text-eq-ink">
                      {localCanonicalCustomers} / {totalCustomers}
                      {customerPct < 100 && (
                        <span className="ml-1 font-normal text-eq-grey">({customerPct}%)</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-eq-sky rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(customerPct, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {/* Sites */}
              {totalSites > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-eq-ink">Sites synced</span>
                    <span className="text-xs font-semibold text-eq-ink">
                      {localCanonicalSites} / {totalSites}
                      {sitePct < 100 && (
                        <span className="ml-1 font-normal text-eq-grey">({sitePct}%)</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-eq-sky rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(sitePct, 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {allSynced && (
                <p className="text-[11px] text-green-700">All records have a canonical ID.</p>
              )}
            </div>
          )}

          {/* Back-fill button — only shown when there are unsynced records */}
          {hasGap && (
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                loading={isPending}
                disabled={isPending}
                onClick={handleBackfill}
              >
                <CloudUpload className="w-3.5 h-3.5 mr-1.5" />
                Back-fill Canonical
              </Button>
              {!isPending && !result && (
                <span className="text-xs text-eq-grey">
                  Syncs{' '}
                  {totalCustomers - localCanonicalCustomers > 0
                    ? `${totalCustomers - localCanonicalCustomers} customer${totalCustomers - localCanonicalCustomers !== 1 ? 's' : ''}`
                    : ''}
                  {totalCustomers - localCanonicalCustomers > 0 && totalSites - localCanonicalSites > 0 ? ' and ' : ''}
                  {totalSites - localCanonicalSites > 0
                    ? `${totalSites - localCanonicalSites} site${totalSites - localCanonicalSites !== 1 ? 's' : ''}`
                    : ''}{' '}
                  without a canonical ID.
                </span>
              )}
            </div>
          )}

          {result && (
            <div className={`mt-3 flex items-start gap-2 text-xs rounded-md px-3 py-2 ${
              result.success
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {result.success
                ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
              <span>
                {result.success
                  ? buildBackfillMessage(result)
                  : result.error}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function buildBackfillMessage(r: BackfillResult): string {
  const parts: string[] = []
  if (r.customers.synced > 0)
    parts.push(`${r.customers.synced} customer${r.customers.synced !== 1 ? 's' : ''} synced`)
  if (r.sites.synced > 0)
    parts.push(`${r.sites.synced} site${r.sites.synced !== 1 ? 's' : ''} synced`)
  if (r.customers.failed + r.sites.failed > 0)
    parts.push(`${r.customers.failed + r.sites.failed} failed (check CANONICAL_API_KEY_SERVICE)`)
  if (parts.length === 0)
    return 'Nothing to sync — all records already have a canonical ID.'
  return `Done — ${parts.join(', ')}.`
}

function FieldSyncCard({
  fieldConfigured,
  totalSites,
  syncedSites,
}: {
  fieldConfigured: boolean
  totalSites: number
  syncedSites: number
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SyncResult | null>(null)
  // Optimistic local counts — bump them after a successful sync so the
  // coverage bar updates without a full page reload.
  const [localSynced, setLocalSynced] = useState(syncedSites)
  const [localTotal, setLocalTotal] = useState(totalSites)

  const coveragePct = localTotal > 0 ? Math.round((localSynced / localTotal) * 100) : 0

  function handleSync() {
    setResult(null)
    startTransition(async () => {
      const res = await syncSitesFromFieldAction()
      setResult(res as SyncResult)
      if ((res as { success: boolean }).success) {
        const r = res as { success: true; created: number; updated: number }
        // Bump counts optimistically — next page load gets the real numbers.
        setLocalTotal((prev) => prev + r.created)
        setLocalSynced((prev) => prev + r.created + r.updated)
      }
    })
  }

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-eq-ice flex items-center justify-center text-eq-deep flex-shrink-0">
          <Link2 className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-eq-ink">EQ Field</h2>
            {fieldConfigured ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Not configured
              </span>
            )}
          </div>

          <p className="text-xs text-eq-grey mb-3">
            Pull the site list from EQ Field into this workspace. EQ Field is the
            single source of truth for sites — this sync updates names and addresses only,
            and never overwrites gate codes, parking notes, or other info captured
            on-site in Service.
          </p>

          {/* Sync coverage indicator */}
          {localTotal > 0 && (
            <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-eq-ink">Sites linked to EQ Field</span>
                <span className="text-xs font-semibold text-eq-ink">
                  {localSynced} / {localTotal}
                  {coveragePct < 100 && (
                    <span className="ml-1 font-normal text-eq-grey">({coveragePct}%)</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-eq-sky rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(coveragePct, 100)}%` }}
                />
              </div>
              {localSynced < localTotal && (
                <p className="text-[11px] text-eq-grey mt-1.5">
                  {Math.max(0, localTotal - localSynced)} site{Math.max(0, localTotal - localSynced) !== 1 ? 's' : ''} not yet linked to EQ Field.
                  Run a sync to match them, or add them in EQ Field first.
                </p>
              )}
              {localSynced >= localTotal && localTotal > 0 && (
                <p className="text-[11px] text-green-700 mt-1.5">All sites are linked to EQ Field.</p>
              )}
            </div>
          )}

          {!fieldConfigured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
              Set <code className="font-mono font-medium">FIELD_API_URL</code> in
              Netlify environment variables to enable this sync.
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={isPending}
              disabled={!fieldConfigured || isPending}
              onClick={handleSync}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Sync Sites from Field
            </Button>
          </div>

          {result && (
            <div className={`mt-3 flex items-start gap-2 text-xs rounded-md px-3 py-2 ${
              result.success
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {result.success
                ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
              <span>
                {result.success
                  ? (result.message ?? `Done — ${result.created} sites added, ${result.updated} updated.`)
                  : result.error}
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
