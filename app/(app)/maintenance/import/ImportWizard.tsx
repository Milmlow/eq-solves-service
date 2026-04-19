'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
  Check,
  Plus,
  SkipForward,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  previewDeltaImportAction,
  commitDeltaImportAction,
  listJobPlansForImportAction,
  type CommitSummary,
  type GroupResolution,
  type PreviewGroup,
  type PreviewResult,
} from './actions'

// ── Resolution state — keyed by group.key ───────────────────────────────

type ResolutionsMap = Record<string, GroupResolution>

/** Lightweight plan row for the combobox. */
interface JobPlanOption {
  id: string
  code: string | null
  name: string
  type: string | null
}

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
  const [resolutions, setResolutions] = useState<ResolutionsMap>({})
  const [isPending, startTransition] = useTransition()
  const [isCommitting, startCommit] = useTransition()

  function handleChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setFile(picked)
    setPreview(null)
    setError(null)
    setCommitResult(null)
    setResolutions({})
  }

  function handlePreview() {
    if (!file) return
    setError(null)
    setCommitResult(null)
    setResolutions({})
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
      // Only send non-empty resolutions to keep the payload small.
      if (Object.keys(resolutions).length > 0) {
        fd.append('resolutions', JSON.stringify(resolutions))
      }
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
    setResolutions({})
    if (fileInput.current) fileInput.current.value = ''
  }

  function setResolution(groupKey: string, resolution: GroupResolution | null) {
    setResolutions((prev) => {
      if (!resolution) {
        const { [groupKey]: _drop, ...rest } = prev
        return rest
      }
      return { ...prev, [groupKey]: resolution }
    })
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
          resolutions={resolutions}
          setResolution={setResolution}
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
  resolutions,
  setResolution,
  onCommit,
  isCommitting,
}: {
  preview: PreviewResult
  resolutions: ResolutionsMap
  setResolution: (groupKey: string, resolution: GroupResolution | null) => void
  onCommit: () => void
  isCommitting: boolean
}) {
  // Lazy-load the full tenant plan list once, on first need. The combobox
  // filters locally so typing is instant and we don't re-fetch per keystroke.
  const [plans, setPlans] = useState<JobPlanOption[] | null>(null)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [plansLoading, setPlansLoading] = useState(false)

  async function ensurePlansLoaded(): Promise<void> {
    if (plans || plansLoading) return
    setPlansLoading(true)
    setPlansError(null)
    const result = await listJobPlansForImportAction()
    setPlansLoading(false)
    if (!result.success) {
      setPlansError(result.error)
      return
    }
    setPlans(result.plans)
  }

  // ── Group-level status ─────────────────────────────────────────────
  // A group is "settled" for commit when:
  //   - it already resolves (matchSource in exact|alias), OR
  //   - the user has a resolution (any of accept/nominate/create/skip)
  // Groups where the user chose 'skip' are excluded from totals/commit.
  const workingGroups = preview.groups.filter(
    (g) => resolutions[g.key]?.action !== 'skip',
  )
  const skippedCount = preview.groups.length - workingGroups.length

  const totalAssets = workingGroups.reduce((n, g) => n + g.assetCount, 0)
  const matchedAssets = workingGroups.reduce((n, g) => n + g.matchedAssetCount, 0)
  const unmatchedAssets = totalAssets - matchedAssets
  const duplicateWOs = workingGroups.reduce((n, g) => n + g.duplicateWorkOrderCount, 0)

  const needsResolution = (g: PreviewGroup): boolean =>
    g.matchSource === 'fuzzy' || g.matchSource === 'none'

  // A group can commit when: site is resolved, frequency is known, assets
  // match & no dup WOs, AND the job plan either auto-matches or the user
  // has provided a resolution (accept/nominate/create).
  const unresolvedAfterUserChoice = workingGroups.filter((g) => {
    const r = resolutions[g.key]
    const planSettled = !needsResolution(g) || (r && r.action !== 'skip')
    const siteOk = !!g.siteId
    const freqOk = !!g.frequency
    const assetsOk = g.unmatchedAssetCount === 0
    const woOk = g.duplicateWorkOrderCount === 0
    return !(planSettled && siteOk && freqOk && assetsOk && woOk)
  }).length

  const canCommit =
    preview.parseErrors.length === 0 &&
    preview.unresolvedSiteCodes.length === 0 &&
    workingGroups.length > 0 &&
    unresolvedAfterUserChoice === 0

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Rows parsed" value={preview.parsedRowCount.toString()} />
        <Stat
          label="Groups"
          value={
            skippedCount > 0
              ? `${workingGroups.length} / ${preview.groups.length}`
              : preview.groups.length.toString()
          }
          tone={skippedCount > 0 ? 'warn' : 'neutral'}
        />
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
          value={unresolvedAfterUserChoice.toString()}
          tone={unresolvedAfterUserChoice > 0 ? 'warn' : 'ok'}
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

      {/* Unresolved job plan codes — hide once the user has resolved every group */}
      {preview.unresolvedJobPlanCodes.length > 0 &&
        preview.groups.some(
          (g) =>
            (g.matchSource === 'fuzzy' || g.matchSource === 'none') && !resolutions[g.key],
        ) && (
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
          {workingGroups.length} Maintenance Check{workingGroups.length === 1 ? '' : 's'} to be created
          {skippedCount > 0 && (
            <span className="ml-2 text-eq-grey/80 normal-case font-normal">
              ({skippedCount} skipped)
            </span>
          )}
        </h2>
        {preview.groups.map((g) => (
          <GroupCard
            key={g.key}
            group={g}
            resolution={resolutions[g.key] ?? null}
            setResolution={(r) => setResolution(g.key, r)}
            plans={plans}
            plansLoading={plansLoading}
            plansError={plansError}
            onRequestPlans={ensurePlansLoaded}
          />
        ))}
      </div>

      {/* Commit bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-4 md:-mx-0 px-4 md:px-0 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-eq-grey">
          {canCommit
            ? `Ready to commit — ${workingGroups.length} check${workingGroups.length === 1 ? '' : 's'} · ${totalAssets} asset${totalAssets === 1 ? '' : 's'}${skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}.`
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

function GroupCard({
  group,
  resolution,
  setResolution,
  plans,
  plansLoading,
  plansError,
  onRequestPlans,
}: {
  group: PreviewGroup
  resolution: GroupResolution | null
  setResolution: (resolution: GroupResolution | null) => void
  plans: JobPlanOption[] | null
  plansLoading: boolean
  plansError: string | null
  onRequestPlans: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  const needsResolution =
    group.matchSource === 'fuzzy' || group.matchSource === 'none'
  const isSkipped = resolution?.action === 'skip'

  const hasHardIssue =
    !group.siteId ||
    (needsResolution && !resolution) ||
    !group.frequency ||
    group.unmatchedAssetCount > 0 ||
    group.duplicateWorkOrderCount > 0

  return (
    <div
      className={`border rounded-lg bg-white overflow-hidden ${
        isSkipped
          ? 'border-gray-200 opacity-60'
          : hasHardIssue
            ? 'border-amber-300'
            : 'border-gray-200'
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
            <ResolutionBadge resolution={resolution} />
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

        <StatusIcon
          hasIssue={hasHardIssue}
          resolved={!hasHardIssue && (!!resolution || !needsResolution)}
          skipped={isSkipped}
        />
      </button>

      {open && (
        <div className="border-t border-gray-200 bg-gray-50">
          {/* Group actions — only offered when the plan needs resolution */}
          {needsResolution && (
            <GroupActions
              group={group}
              resolution={resolution}
              setResolution={setResolution}
              plans={plans}
              plansLoading={plansLoading}
              plansError={plansError}
              onRequestPlans={onRequestPlans}
            />
          )}

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
  tone: 'info' | 'warn' | 'error' | 'ok' | 'muted'
  children: React.ReactNode
}) {
  const cls =
    tone === 'info'
      ? 'bg-eq-ice text-eq-deep border-eq-sky/30'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : tone === 'error'
          ? 'bg-red-50 text-red-800 border-red-200'
          : tone === 'ok'
            ? 'bg-green-50 text-green-800 border-green-200'
            : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 border rounded ${cls}`}
    >
      {children}
    </span>
  )
}

function StatusIcon({
  hasIssue,
  resolved,
  skipped,
}: {
  hasIssue: boolean
  resolved?: boolean
  skipped?: boolean
}) {
  if (skipped) return <SkipForward className="w-4 h-4 text-eq-grey shrink-0" />
  if (resolved) return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
  if (hasIssue) return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
  return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
}

// ── Resolution badge — surfaced on the group header ─────────────────────

function ResolutionBadge({ resolution }: { resolution: GroupResolution | null }) {
  if (!resolution) return null
  switch (resolution.action) {
    case 'accept':
      return <Badge tone="ok">accepted</Badge>
    case 'nominate':
      return <Badge tone="ok">nominated</Badge>
    case 'create':
      return (
        <Badge tone="ok">
          will create <span className="font-mono">{resolution.code}</span>
        </Badge>
      )
    case 'skip':
      return <Badge tone="muted">skipped</Badge>
  }
}

// ── Group actions row ───────────────────────────────────────────────────

function GroupActions({
  group,
  resolution,
  setResolution,
  plans,
  plansLoading,
  plansError,
  onRequestPlans,
}: {
  group: PreviewGroup
  resolution: GroupResolution | null
  setResolution: (resolution: GroupResolution | null) => void
  plans: JobPlanOption[] | null
  plansLoading: boolean
  plansError: string | null
  onRequestPlans: () => Promise<void>
}) {
  // Which inline sub-form is currently showing.
  const [mode, setMode] = useState<'none' | 'nominate' | 'create'>('none')

  // Keep mode in sync with an externally-applied resolution.
  useEffect(() => {
    if (!resolution) setMode('none')
    else if (resolution.action === 'nominate') setMode('nominate')
    else if (resolution.action === 'create') setMode('create')
    else setMode('none')
  }, [resolution])

  const acceptCandidate = group.fuzzyCandidate
  const canAccept = !!acceptCandidate

  return (
    <div className="px-4 py-3 bg-eq-ice/40 border-b border-eq-sky/30 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-eq-grey uppercase tracking-wide">
          Group actions
        </span>

        {canAccept && (
          <ActionButton
            active={resolution?.action === 'accept'}
            onClick={() => {
              setMode('none')
              setResolution(resolution?.action === 'accept' ? null : { action: 'accept' })
            }}
            icon={<Check className="w-3.5 h-3.5" />}
          >
            Accept "{acceptCandidate!.code}"
          </ActionButton>
        )}

        <ActionButton
          active={resolution?.action === 'nominate'}
          onClick={async () => {
            await onRequestPlans()
            if (resolution?.action === 'nominate') {
              setResolution(null)
              setMode('none')
            } else {
              setMode('nominate')
            }
          }}
          icon={<Search className="w-3.5 h-3.5" />}
        >
          Nominate existing
        </ActionButton>

        <ActionButton
          active={resolution?.action === 'create'}
          onClick={() => {
            if (resolution?.action === 'create') {
              setResolution(null)
              setMode('none')
            } else {
              setMode('create')
            }
          }}
          icon={<Plus className="w-3.5 h-3.5" />}
        >
          Create job plan
        </ActionButton>

        <ActionButton
          active={resolution?.action === 'skip'}
          tone="muted"
          onClick={() => {
            setMode('none')
            setResolution(resolution?.action === 'skip' ? null : { action: 'skip' })
          }}
          icon={<SkipForward className="w-3.5 h-3.5" />}
        >
          Skip group
        </ActionButton>

        {resolution && (
          <button
            type="button"
            onClick={() => {
              setResolution(null)
              setMode('none')
            }}
            className="ml-auto text-[11px] text-eq-grey hover:text-eq-deep underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Inline sub-forms */}
      {mode === 'nominate' && (
        <PlanCombobox
          plans={plans}
          plansLoading={plansLoading}
          plansError={plansError}
          onRequestPlans={onRequestPlans}
          selectedId={resolution?.action === 'nominate' ? resolution.jobPlanId : null}
          onPick={(planId) => setResolution({ action: 'nominate', jobPlanId: planId })}
        />
      )}

      {mode === 'create' && (
        <CreatePlanInline
          defaultCode={group.jobPlanCodeRaw}
          current={resolution?.action === 'create' ? resolution : null}
          onApply={(code, name, type) =>
            setResolution({ action: 'create', code, name, type: type || null })
          }
          onClear={() => setResolution(null)}
        />
      )}
    </div>
  )
}

// ── Action button ───────────────────────────────────────────────────────

function ActionButton({
  active,
  tone = 'primary',
  icon,
  children,
  onClick,
}: {
  active: boolean
  tone?: 'primary' | 'muted'
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  const base =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors'
  const cls = active
    ? tone === 'muted'
      ? 'bg-gray-600 text-white border-gray-600'
      : 'bg-eq-sky text-white border-eq-sky'
    : 'bg-white text-eq-ink border-gray-300 hover:border-eq-sky hover:text-eq-deep'
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {icon}
      {children}
    </button>
  )
}

// ── Plan combobox (searchable dropdown for Nominate) ────────────────────

function PlanCombobox({
  plans,
  plansLoading,
  plansError,
  onRequestPlans,
  selectedId,
  onPick,
}: {
  plans: JobPlanOption[] | null
  plansLoading: boolean
  plansError: string | null
  onRequestPlans: () => Promise<void>
  selectedId: string | null
  onPick: (planId: string) => void
}) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    void onRequestPlans()
  }, [onRequestPlans])

  const filtered = useMemo(() => {
    if (!plans) return []
    const q = query.trim().toLowerCase()
    if (!q) return plans.slice(0, 50)
    return plans
      .filter((p) => {
        const code = (p.code ?? '').toLowerCase()
        const name = p.name.toLowerCase()
        const type = (p.type ?? '').toLowerCase()
        return code.includes(q) || name.includes(q) || type.includes(q)
      })
      .slice(0, 50)
  }, [plans, query])

  const selected = plans?.find((p) => p.id === selectedId) ?? null

  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-200">
        <Search className="w-3.5 h-3.5 text-eq-grey shrink-0" />
        <input
          type="text"
          placeholder="Search by code, name, or type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-xs text-eq-ink placeholder-eq-grey/70 focus:outline-none"
          autoFocus
        />
        {plansLoading && <span className="text-[10px] text-eq-grey">loading…</span>}
      </div>

      {plansError && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50">{plansError}</div>
      )}

      {selected && (
        <div className="px-3 py-1.5 flex items-center gap-2 bg-eq-ice/70 border-b border-eq-sky/30">
          <Check className="w-3.5 h-3.5 text-green-700" />
          <span className="text-xs">
            <span className="font-mono text-eq-deep">{selected.code ?? '—'}</span>
            <span className="text-eq-grey"> — </span>
            <span className="text-eq-ink">{selected.name}</span>
          </span>
        </div>
      )}

      <div className="max-h-48 overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-eq-grey">
            {plans === null ? 'Loading plans…' : 'No matching plans.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((p) => {
              const isPicked = p.id === selectedId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-eq-ice/50 ${
                      isPicked ? 'bg-eq-ice/70' : ''
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-eq-deep shrink-0">
                        {p.code ?? '—'}
                      </span>
                      <span className="text-eq-ink truncate">{p.name}</span>
                      {p.type && (
                        <span className="text-eq-grey text-[10px] ml-auto truncate shrink">
                          {p.type}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Inline "Create new plan" form ───────────────────────────────────────

function CreatePlanInline({
  defaultCode,
  current,
  onApply,
  onClear,
}: {
  defaultCode: string
  current: Extract<GroupResolution, { action: 'create' }> | null
  onApply: (code: string, name: string, type: string) => void
  onClear: () => void
}) {
  const [code, setCode] = useState(current?.code ?? defaultCode)
  const [name, setName] = useState(current?.name ?? '')
  const [type, setType] = useState(current?.type ?? '')

  const dirty =
    !current ||
    current.code !== code.trim() ||
    current.name !== name.trim() ||
    (current.type ?? '') !== type.trim()

  const canApply = code.trim().length > 0 && name.trim().length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <FieldInput
          label="Code"
          value={code}
          onChange={setCode}
          mono
          placeholder="e.g. LTSWBD"
        />
        <FieldInput
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Low Tension Switchboard"
        />
        <FieldInput
          label="Type (optional)"
          value={type}
          onChange={setType}
          placeholder="e.g. Annual"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!canApply || !dirty}
          onClick={() => onApply(code.trim(), name.trim(), type.trim())}
        >
          {current ? 'Update' : 'Apply'}
        </Button>
        {current && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-eq-grey hover:text-eq-deep inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Discard
          </button>
        )}
        <p className="ml-auto text-[11px] text-eq-grey">
          A tenant-global plan will be created (no items — add later under Job Plans).
        </p>
      </div>
    </div>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-eq-grey uppercase tracking-wide mb-0.5">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:border-eq-sky ${
          mono ? 'font-mono' : ''
        }`}
      />
    </label>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
