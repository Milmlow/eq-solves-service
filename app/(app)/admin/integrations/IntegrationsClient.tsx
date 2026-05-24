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
}

export function IntegrationsClient({ fieldConfigured }: Props) {
  return (
    <div className="space-y-4">
      <FieldSyncCard fieldConfigured={fieldConfigured} />
    </div>
  )
}

function FieldSyncCard({ fieldConfigured }: { fieldConfigured: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SyncResult | null>(null)

  function handleSync() {
    setResult(null)
    startTransition(async () => {
      const res = await syncSitesFromFieldAction()
      setResult(res as SyncResult)
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
            Pull the site list from EQ Field into this workspace. Field is the
            canonical owner of sites — this sync updates names and addresses only,
            and never overwrites gate codes, parking notes, or other info captured
            on-site in Service.
          </p>

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
