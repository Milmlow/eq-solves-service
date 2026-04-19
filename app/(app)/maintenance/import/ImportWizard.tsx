'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  previewDeltaImportAction,
  commitDeltaImportAction,
  type CommitSummary,
  type PreviewGroup,
  type PreviewResult,
} from './actions'

/**
 * Delta WO import wizard.
 *
 * Step 1: choose file → call `previewDeltaImportAction`
 * Step 2: show preview — unresolved items, groups, per-asset detail
 * Step 3: (not yet wired) commit server action + redirect to /maintenance
 */
export function ImportWizard() {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<CommitSummary | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isCommitting, startCommit] = useTransition()

  function handleChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setFile(picked)
    setPreview(null)
    setError(null)
    setCommitResult(null)
  }

  function handlePreview() {
    if (!file) return
    setError(null)
    setCommitResult(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const result = await previewDeltaImportAction(fd)
      if (!result.success) {
        setError(result.error)
        setPreview(null)
        return
      }
      setPreview(result)
    })
  }

  function handleCommit() {
    if (!file) return
    setError(null)
    startCommit(async () => {
      const fd = new FormData()
      fd.append('file', file)
      // Generate an idempotency key scoped to this commit attempt. A client
      // retry inside the same tab reuses the same id — safe replay.
      const mutationId = cryptoRandomId()
      const result = await commitDeltaImportAction(fd, mutationId)
      if (!result.success) {
        setError(result.error)
        return
      }
      setCommitResult(result.data ?? null)
      router.refresh()
    })
  }

  function handleReset() {
    setFile(null)
    setPreview(null)
    setError(null)
    setCommitResult(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="space-y-5">
      {/* Upload strip */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            onChange={handleChoose}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            {file ? 'Change file' : 'Choose .xlsx'}
          </Button>

          {file && (
            <div className="flex items-center gap-2 text-sm text-eq-ink">
              <FileText className="w-4 h-4 text-eq-sky" />
              <span className="font-medium">{file.name}</span>
              <span className="text-eq-grey">({formatBytes(file.size)})</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {preview && (
              <Button variant="secondary" size="sm" onClick={handleReset}>
                Start over
              </Button>
            )}
            <Button size="sm" disabled={!file || isPending} onClick={handlePreview}>
              {isPending ? 'Parsing…' : preview ? 'Re-parse' : 'Preview'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Commit result takes precedence over preview */}
      {commitResult && (
        <CommitSuccess summary={commitResult} onDone={handleReset} />
      )}

      {/* Preview */}
      {preview && !commitResult && (
        <Preview
          preview={preview}
          onCommit={handleCommit}
          isCommitting={isCommitting}
        />
      )}
    </div>
  )
}

function cryptoRandomId(): string {
  // Prefer the browser's crypto.randomUUID where available; fall back to a
  // timestamp + random suffix. Only called from a client component.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Preview sub-component ───────────────────────────────────────────────

function Preview({
  preview,
  onCommit,
  isCommitting,
}: {
  preview: PreviewResult
  onCommit: () => void
  isCommitting: boolean
}) {
  const totalAssets = preview.groups.reduce((n, g) => n + g.assetCount, 0)
  const matchedAssets = preview.groups.reduce((n, g) => n + g.matchedAssetCount, 0)
  const unmatchedAssets = totalAssets - matchedAssets
  const duplicateWOs = preview.groups.reduce((n, g) => n + g.duplicateWorkOrderCount, 0)
  const unresolvedGroups = preview.groups.filter(
    (g) => !g.jobPlanId || !g.siteId || !g.frequency,
  ).length

  const canCommit =
    preview.parseErrors.length === 0 &&
    preview.unresolvedSiteCodes.length === 0 &&
    preview.unresolvedJobPlanCodes.length === 0 &&
    unmatchedAssets === 0 &&
    duplicateWOs === 0 &&
    preview.groups.every((g) => g.frequency !== null)

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Rows parsed" value={preview.parsedRowCount.toString()} />
        <Stat label="Groups" value={preview.groups.length.toString()} />
        <Stat
          label="Assets matched"
          value={`${matchedAssets} / ${totalAssets}`}
          tone={unmatchedAssets > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Duplicate WO#s"
          value={duplicateWOs.toString()}
          tone={duplicateWOs > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Groups needing review"
          value={unresolvedGroups.toString()}
          tone={unresolvedGroups > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* Parse errors */}
      {preview.parseErrors.length > 0 && (
        <Banner tone="error" icon={<AlertCircle className="w-4 h-4" />}>
          <p className="font-medium mb-1">
            {preview.parseErrors.length} row{preview.parseErrors.length === 1 ? '' : 's'} failed to parse —
            fix the sheet and re-upload.
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-xs">
            {preview.parseErrors.slice(0, 6).map((e, i) => (
              <li key={i}>
                Row {e.rowNumber}: {e.message}
              </li>
            ))}
            {preview.parseErrors.length > 6 && (
              <li className="text-eq-grey">…and {preview.parseErrors.length - 6} more</li>
            )}
          </ul>
        </Banner>
      )}

      {/* Unresolved sites */}
      {preview.unresolvedSiteCodes.length > 0 && (
        <Banner tone="warn" icon={<AlertTriangle className="w-4 h-4" />}>
          <p className="font-medium mb-1">
            Site code{preview.unresolvedSiteCodes.length === 1 ? '' : 's'} not found in EQ:{' '}
            <span className="font-mono">{preview.unresolvedSiteCodes.join(', ')}</span>
          </p>
          <p className="text-xs text-eq-grey">
            Create the site(s) in{' '}
            <Link href="/sites" className="underline hover:text-eq-deep">
              Sites
            </Link>{' '}
            with the matching <code>code</code>, then re-upload.
          </p>
        </Banner>
      )}

      {/* Unresolved job plan codes */}
      {preview.unresolvedJobPlanCodes.length > 0 && (
        <Banner tone="warn" icon={<AlertTriangle className="w-4 h-4" />}>
          <p className="font-medium mb-1">
            {preview.unresolvedJobPlanCodes.length} job plan code
            {preview.unresolvedJobPlanCodes.length === 1 ? '' : 's'} not found:{' '}
            <span className="font-mono">{preview.unresolvedJobPlanCodes.join(', ')}</span>
          </p>
          <p className="text-xs text-eq-grey">
            Check for fuzzy-match suggestions below, or add the missing plans in{' '}
            <Link href="/job-plans" className="underline hover:text-eq-deep">
              Job Plans
            </Link>
            . After the next import you'll be prompted to create an alias.
          </p>
        </Banner>
      )}

      {/* Group list */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-eq-grey uppercase tracking-wide">
          {preview.groups.length} Maintenance Check{preview.groups.length === 1 ? '' : 's'} to be created
        </h2>
        {preview.groups.map((g) => (
          <GroupCard key={g.key} group={g} />
        ))}
      </div>

      {/* Commit bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-4 md:-mx-0 px-4 md:px-0 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-eq-grey">
          {canCommit
            ? `Ready to commit — ${preview.groups.length} check${preview.groups.length === 1 ? '' : 's'} · ${totalAssets} asset${totalAssets === 1 ? '' : 's'} · ${preview.groups.reduce(
                (n, g) => n + g.assetCount,
                0,
              )} work orders.`
            : 'Resolve the flagged items above before committing.'}
        </p>
        <Button
          size="sm"
          disabled={!canCommit || isCommitting}
          onClick={onCommit}
          title={canCommit ? 'Create maintenance checks from this file' : 'Resolve warnings before committing'}
        >
          {isCommitting ? 'Committing…' : 'Commit import'}
        </Button>
      </div>
    </div>
  )
}

// ── Commit success screen ───────────────────────────────────────────────

function CommitSuccess({
  summary,
  onDone,
}: {
  summary: CommitSummary
  onDone: () => void
}) {
  return (
    <div className="space-y-4">
      <Banner tone="ok" icon={<CheckCircle2 className="w-4 h-4" />}>
        <p className="font-medium">
          Imported {summary.checksCreated} maintenance check
          {summary.checksCreated === 1 ? '' : 's'} · {summary.checkAssetsCreated} assets ·{' '}
          {summary.checkItemsCreated} tasks.
        </p>
      </Banner>

      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-eq-grey uppercase tracking-wide">
              <th className="px-3 py-2 font-bold">Check</th>
              <th className="px-3 py-2 font-bold">Site</th>
              <th className="px-3 py-2 font-bold">Plan</th>
              <th className="px-3 py-2 font-bold">Frequency</th>
              <th className="px-3 py-2 font-bold">Start</th>
              <th className="px-3 py-2 font-bold text-right">Assets</th>
              <th className="px-3 py-2 font-bold text-right">Tasks</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {summary.groupsCreated.map((g) => (
              <tr key={g.checkId} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-eq-ink">{g.customName}</td>
                <td className="px-3 py-1.5 font-mono">{g.siteCode}</td>
                <td className="px-3 py-1.5 font-mono">{g.jobPlanCode}</td>
                <td className="px-3 py-1.5 text-eq-grey">{g.frequency}</td>
                <td className="px-3 py-1.5 text-eq-grey">{g.startDate}</td>
                <td className="px-3 py-1.5 text-right">{g.assetCount}</td>
                <td className="px-3 py-1.5 text-right">{g.taskCount}</td>
                <td className="px-3 py-1.5">
                  <Link
                    href={`/maintenance/${g.checkId}`}
                    className="text-eq-sky hover:text-eq-deep underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onDone}>
          Import another file
        </Button>
        <Link href="/maintenance">
          <Button size="sm">Go to Maintenance</Button>
        </Link>
      </div>
    </div>
  )
}

// ── Group card ──────────────────────────────────────────────────────────

function GroupCard({ group }: { group: PreviewGroup }) {
  const [open, setOpen] = useState(false)

  const hasHardIssue =
    !group.siteId ||
    !group.jobPlanId ||
    !group.frequency ||
    group.unmatchedAssetCount > 0 ||
    group.duplicateWorkOrderCount > 0

  return (
    <div
      className={`border rounded-lg bg-white overflow-hidden ${
        hasHardIssue ? 'border-amber-300' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-eq-grey shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-eq-grey shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-eq-ink">
              {group.siteCode}
            </span>
            <span className="text-eq-grey">·</span>
            <span className="text-sm font-mono text-eq-deep">{group.jobPlanCode}</span>
            {group.matchSource === 'alias' && (
              <Badge tone="info">alias: {group.jobPlanCodeRaw}</Badge>
            )}
            {group.matchSource === 'fuzzy' && group.fuzzyCandidate && (
              <Badge tone="warn">
                fuzzy: {group.jobPlanCodeRaw} → {group.fuzzyCandidate.code}
              </Badge>
            )}
            {group.matchSource === 'none' && <Badge tone="error">no match</Badge>}
            <span className="text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">
              {group.frequency ?? `(unknown: ${group.frequencySuffix})`}
            </span>
            <span className="text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">{group.startDate}</span>
          </div>
          <div className="text-xs text-eq-grey mt-0.5">
            {group.assetCount} asset{group.assetCount === 1 ? '' : 's'}
            {group.matchedAssetCount < group.assetCount && (
              <>
                {' · '}
                <span className="text-amber-700">
                  {group.unmatchedAssetCount} unmatched
                </span>
              </>
            )}
            {group.duplicateWorkOrderCount > 0 && (
              <>
                {' · '}
                <span className="text-amber-700">
                  {group.duplicateWorkOrderCount} duplicate WO#
                </span>
              </>
            )}
            {group.jobPlanName && (
              <span className="text-eq-grey"> · {group.jobPlanName}</span>
            )}
          </div>
        </div>

        <StatusIcon hasIssue={hasHardIssue} />
      </button>

      {open && (
        <div className="border-t border-gray-200 bg-gray-50">
          {group.issues.length > 0 && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
              <ul className="text-xs text-amber-800 space-y-0.5">
                {group.issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-auto max-h-96">
            <table className="min-w-full text-xs">
              <thead className="bg-white sticky top-0 z-10 border-b border-gray-200">
                <tr className="text-left text-eq-grey uppercase tracking-wide">
                  <th className="px-3 py-2 font-bold">Row</th>
                  <th className="px-3 py-2 font-bold">WO#</th>
                  <th className="px-3 py-2 font-bold">Maximo ID</th>
                  <th className="px-3 py-2 font-bold">Description</th>
                  <th className="px-3 py-2 font-bold">Location</th>
                  <th className="px-3 py-2 font-bold">EQ Asset</th>
                </tr>
              </thead>
              <tbody>
                {group.assets.map((a) => (
                  <tr key={a.rowNumber} className="border-t border-gray-100 bg-white">
                    <td className="px-3 py-1.5 text-eq-grey">{a.rowNumber}</td>
                    <td className="px-3 py-1.5 font-mono">
                      {a.workOrder}
                      {a.duplicateWorkOrder && (
                        <span className="ml-1.5 text-amber-700">(dup)</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{a.maximoAssetId}</td>
                    <td className="px-3 py-1.5 text-eq-ink">{a.description || '—'}</td>
                    <td className="px-3 py-1.5 text-eq-grey">{a.location ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {a.resolvedAssetId ? (
                        <span className="inline-flex items-center gap-1 text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {a.resolvedAssetName ?? a.resolvedAssetId}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          no match
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tiny primitives ─────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-green-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-eq-ink'
  return (
    <div className="border border-gray-200 bg-white rounded-md px-3 py-2">
      <p className="text-[10px] text-eq-grey uppercase tracking-wide font-bold">
        {label}
      </p>
      <p className={`text-lg font-bold ${toneCls}`}>{value}</p>
    </div>
  )
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'warn' | 'error' | 'ok'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const cls =
    tone === 'error'
      ? 'bg-red-50 border-red-200 text-red-800'
      : tone === 'warn'
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-green-50 border-green-200 text-green-800'
  return (
    <div className={`border rounded-md p-3 text-sm ${cls}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'info' | 'warn' | 'error'
  children: React.ReactNode
}) {
  const cls =
    tone === 'info'
      ? 'bg-eq-ice text-eq-deep border-eq-sky/30'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-red-50 text-red-800 border-red-200'
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 border rounded ${cls}`}
    >
      {children}
    </span>
  )
}

function StatusIcon({ hasIssue }: { hasIssue: boolean }) {
  return hasIssue ? (
    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
  ) : (
    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
