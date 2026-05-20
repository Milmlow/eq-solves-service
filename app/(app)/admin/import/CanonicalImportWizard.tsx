'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  previewDeltaCanonicalAction,
  commitDeltaCanonicalAction,
  type CanonicalPreviewResult,
  type CanonicalPreviewGroup,
  type CanonicalCommitSummary,
} from './actions'

type WizardState =
  | { stage: 'idle' }
  | { stage: 'parsing'; filename: string }
  | { stage: 'preview'; file: File; preview: CanonicalPreviewResult }
  | { stage: 'committing'; file: File; preview: CanonicalPreviewResult }
  | { stage: 'committed'; summary: CanonicalCommitSummary }
  | { stage: 'error'; message: string }

export function CanonicalImportWizard() {
  const router = useRouter()
  const [state, setState] = useState<WizardState>({ stage: 'idle' })
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    setState({ stage: 'parsing', filename: file.name })
    const fd = new FormData()
    fd.set('file', file)
    startTransition(async () => {
      const result = await previewDeltaCanonicalAction(fd)
      if (!result.success) {
        setState({ stage: 'error', message: result.error })
        return
      }
      setState({ stage: 'preview', file, preview: result })
    })
  }

  function handleCommit() {
    if (state.stage !== 'preview') return
    const { file, preview } = state
    setState({ stage: 'committing', file, preview })
    const fd = new FormData()
    fd.set('file', file)
    startTransition(async () => {
      const result = await commitDeltaCanonicalAction(fd)
      if (!result.success) {
        setState({ stage: 'error', message: result.error })
        return
      }
      const summary = result.data ?? { checksCreated: 0, checkAssetsCreated: 0, groupsCreated: [] }
      setState({ stage: 'committed', summary })
      router.refresh()
    })
  }

  function reset() {
    setState({ stage: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Idle / file picker ─────────────────────────────────────────────
  if (state.stage === 'idle' || state.stage === 'error') {
    return (
      <div className="space-y-4">
        <label className="flex flex-col items-center gap-3 p-10 border-2 border-dashed border-eq-line rounded-xl cursor-pointer hover:border-eq-sky">
          <Upload className="w-8 h-8 text-eq-grey" />
          <span className="text-sm font-medium text-eq-ink">
            Drop or pick the monthly Delta WO .xlsx
          </span>
          <span className="text-xs text-eq-grey">
            Validated against canonical schemas before commit
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </label>
        {state.stage === 'error' && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{state.message}</span>
          </div>
        )}
      </div>
    )
  }

  if (state.stage === 'parsing') {
    return (
      <div className="flex items-center gap-3 p-6 border border-eq-line rounded-xl text-sm text-eq-grey">
        <Loader2 className="w-4 h-4 animate-spin" />
        Parsing {state.filename}…
      </div>
    )
  }

  if (state.stage === 'committed') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-md text-sm">
          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <div className="font-medium text-green-900">
              Committed {state.summary.checksCreated} maintenance check
              {state.summary.checksCreated === 1 ? '' : 's'} ·{' '}
              {state.summary.checkAssetsCreated} check_asset rows
            </div>
            <div className="text-green-800 text-xs">
              Every projected row passed ajv against the canonical schemas before write.
              Audit log entry created. Re-fetch <code>/api/admin/export</code> to verify the
              round-trip.
            </div>
          </div>
        </div>
        <div className="border border-eq-line rounded-md divide-y divide-eq-line">
          {state.summary.groupsCreated.map((g) => (
            <div key={g.checkId} className="px-3 py-2 flex items-center gap-3 text-sm">
              <span className="font-medium text-eq-ink">
                {g.siteCode} · {g.jobPlanCode}
              </span>
              <span className="text-eq-grey">{g.startDate}</span>
              <span className="ml-auto text-eq-grey text-xs">
                {g.assetCount} asset{g.assetCount === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
        <Button variant="secondary" onClick={reset}>
          Import another
        </Button>
      </div>
    )
  }

  // stage === 'preview' or 'committing'
  const { preview } = state
  const committable = preview.groups.every((g) => g.commitReady) && preview.groups.length > 0

  return (
    <div className="space-y-4">
      <PreviewHeader preview={preview} />
      <div className="space-y-3">
        {preview.groups.map((g) => (
          <GroupCard key={g.key} group={g} />
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="secondary"
          onClick={reset}
          disabled={state.stage === 'committing' || isPending}
        >
          Cancel
        </Button>
        <Button
          onClick={handleCommit}
          loading={state.stage === 'committing' || isPending}
          disabled={!committable}
        >
          {committable
            ? `Commit ${preview.groups.length} group${preview.groups.length === 1 ? '' : 's'}`
            : 'Resolve blockers to commit'}
        </Button>
        <span className="ml-auto text-xs text-eq-grey">
          {preview.validRowCount} valid · {preview.invalidRowCount} invalid · validated against{' '}
          <code className="text-[10px]">{preview.schemaIds.maintenance_check.split('/').pop()}</code>{' '}
          +{' '}
          <code className="text-[10px]">{preview.schemaIds.check_asset.split('/').pop()}</code>
        </span>
      </div>
    </div>
  )
}

function PreviewHeader({ preview }: { preview: CanonicalPreviewResult }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
      <Stat label="File" value={preview.filename} icon={FileText} />
      <Stat label="Parsed rows" value={preview.parsedRowCount.toString()} />
      <Stat label="Groups" value={preview.groups.length.toString()} />
      <Stat
        label="Schema-valid"
        value={preview.validRowCount.toString()}
        tone={preview.invalidRowCount === 0 ? 'good' : 'warn'}
      />
      <Stat
        label="Schema-invalid"
        value={preview.invalidRowCount.toString()}
        tone={preview.invalidRowCount === 0 ? 'neutral' : 'bad'}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  icon?: typeof FileText
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const toneClass =
    tone === 'good'
      ? 'border-green-200 bg-green-50'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : tone === 'bad'
          ? 'border-red-200 bg-red-50'
          : 'border-eq-line bg-white'
  return (
    <div className={`px-3 py-2 border rounded-md ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-eq-grey">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <div className="text-sm font-medium text-eq-ink truncate" title={value}>
        {value}
      </div>
    </div>
  )
}

function GroupCard({ group }: { group: CanonicalPreviewGroup }) {
  const [open, setOpen] = useState(false)
  const headerTone = group.commitReady
    ? 'border-green-200'
    : group.issues.length > 0
      ? 'border-amber-200'
      : 'border-eq-line'

  return (
    <div className={`border rounded-md ${headerTone}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-eq-ice/60"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-eq-grey" />
        ) : (
          <ChevronRight className="w-4 h-4 text-eq-grey" />
        )}
        <span className="text-sm font-medium text-eq-ink">
          {group.siteCode} · {group.jobPlanCode}
        </span>
        <span className="text-xs text-eq-grey">
          {group.frequency ?? `unknown:${group.frequencySuffix}`} · {group.startDate}
        </span>
        <span className="ml-auto text-xs text-eq-grey">
          {group.matchedAssetCount}/{group.assetCount} resolved
        </span>
        {group.commitReady ? (
          <CheckCircle2 className="w-4 h-4 text-green-600" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-600" />
        )}
      </button>
      {open && (
        <div className="border-t border-eq-line px-3 py-3 space-y-3 text-sm">
          {group.issues.length > 0 && (
            <ul className="space-y-1">
              {group.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-amber-700">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span className="text-xs">{issue}</span>
                </li>
              ))}
            </ul>
          )}
          {group.canonicalCheck && (
            <div className="bg-eq-ice/40 border border-eq-line rounded p-2">
              <div className="text-[10px] uppercase tracking-wider text-eq-grey mb-1">
                Canonical maintenance_check
              </div>
              <pre className="text-[11px] text-eq-ink whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(group.canonicalCheck, null, 2)}
              </pre>
            </div>
          )}
          <div className="border border-eq-line rounded divide-y divide-eq-line">
            <div className="px-2 py-1.5 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-eq-grey bg-eq-ice/40">
              <div className="col-span-1">Row</div>
              <div className="col-span-2">WO</div>
              <div className="col-span-2">Maximo ID</div>
              <div className="col-span-3">Description</div>
              <div className="col-span-3">Resolved asset</div>
              <div className="col-span-1 text-right">Status</div>
            </div>
            {group.assets.map((a) => {
              const ok = a.canonical !== null && a.schemaErrors.length === 0
              return (
                <div
                  key={`${a.rowNumber}:${a.workOrder}`}
                  className="px-2 py-1.5 grid grid-cols-12 gap-2 text-[12px] items-start"
                >
                  <div className="col-span-1 text-eq-grey">{a.rowNumber}</div>
                  <div className="col-span-2 font-mono text-eq-ink">{a.workOrder}</div>
                  <div className="col-span-2 font-mono text-eq-ink">{a.maximoAssetId}</div>
                  <div className="col-span-3 text-eq-grey truncate" title={a.description}>
                    {a.description}
                  </div>
                  <div className="col-span-3 truncate" title={a.resolvedAssetName ?? ''}>
                    {a.resolvedAssetName ? (
                      <span className="text-eq-ink">{a.resolvedAssetName}</span>
                    ) : (
                      <span className="text-amber-700">unresolved</span>
                    )}
                    {a.schemaErrors.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {a.schemaErrors.map((e, i) => (
                          <li key={i} className="text-[11px] text-red-600">
                            {e.path} {e.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="col-span-1 text-right">
                    {ok ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 inline" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-600 inline" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
