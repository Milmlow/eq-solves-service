'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { RefreshCw, CheckCircle2, AlertCircle, Link2 } from 'lucide-react'
import { syncSitesFromFieldAction } from './actions'

type SyncResult =
  | { success: true; created: number; updated: number; message?: string }
  | { success: false; error: string }

interface Props {
  fieldConfigured: boolean
  totalSites: number
  syncedSites: number
}

export function IntegrationsClient({ fieldConfigured, totalSites, syncedSites }: Props) {
  return (
    <div className="space-y-4">
      <FieldSyncCard
        fieldConfigured={fieldConfigured}
        totalSites={totalSites}
        syncedSites={syncedSites}
      />
    </div>
  )
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
