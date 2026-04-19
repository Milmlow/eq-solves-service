'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
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
  Link2,
  Plus,
  CircleSlash,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  previewDeltaImportAction,
  commitDeltaImportAction,
  type CommitSummary,
  type PreviewAsset,
  type PreviewGroup,
  type PreviewResult,
} from './actions'
import {
  acceptAliasAction,
  linkAssetToRowAction,
  skipGroupAction,
  skipRowAction,
  clearOverrideAction,
  type AssetSearchHit,
} from './fix-actions'
import { AssetPicker } from './AssetPicker'
import { CreateAssetDialog, CreateJobPlanDialog } from './InlineFixForms'

/**
 * Delta WO import wizard.
 *
 *  Step 1. Choose file → previewDeltaImportAction (creates/reuses an
 *          import_session keyed by sha256(file)).
 *  Step 2. Preview groups. Unresolved items expose inline fixes:
 *          - group with fuzzy job plan → Accept alias / Create plan / Skip
 *          - unmatched row → Link asset / Create asset / Skip row
 *          Each fix calls a server action in `fix-actions.ts` which writes
 *          to `import_overrides`, then we re-parse so the UI reflects it.
 *  Step 3. When the preview has zero blockers, commit — server action
 *          honors all outstanding overrides and marks the session done.
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

  const runPreview = useCallback(
    (f: File, sessionId: string | null) => {
      setError(null)
      setCommitResult(null)
      startTransition(async () => {
        const fd = new FormData()
        fd.append('file', f)
        if (sessionId) fd.append('importSessionId', sessionId)
        const result = await previewDeltaImportAction(fd)
        if (!result.success) {
          setError(result.error)
          setPreview(null)
          return
        }
        setPreview(result)
      })
    },
    [],
  )

  function handlePreview() {
    if (!file) return
    runPreview(file, preview?.importSessionId ?? null)
  }

  function handleCommit() {
    if (!file || !preview) return
    setError(null)
    startCommit(async () => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('importSessionId', preview.importSessionId)
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
      {preview && !commitResult && file && (
        <Preview
          preview={preview}
          file={file}
          onCommit={handleCommit}
          isCommitting={isCommitting}
          onReparse={() => runPreview(file, preview.importSessionId)}
          isPending={isPending}
        />
      )}
    </div>
  )
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Preview sub-component ───────────────────────────────────────────────

function Preview({
  preview,
  file,
  onCommit,
  isCommitting,
  onReparse,
  isPending,
}: {
  preview: PreviewResult
  file: File
  onCommit: () => void
  isCommitting: boolean
  onReparse: () => void
  isPending: boolean
}) {
  // Skipped items are no longer counted in the commit gate.
  const activeGroups = preview.groups.filter((g) => !g.skipped)
  const totalAssets = activeGroups.reduce((n, g) => n + g.matchedAssetCount + g.unmatchedAssetCount, 0)
  const matchedAssets = activeGroups.reduce((n, g) => n + g.matchedAssetCount, 0)
  const unmatchedAssets = activeGroups.reduce((n, g) => n + g.unmatchedAssetCount, 0)
  const duplicateWOs = activeGroups.reduce((n, g) => n + g.duplicateWorkOrderCount, 0)
  const unresolvedGroups = activeGroups.filter(
    (g) => !g.jobPlanId || !g.siteId || !g.frequency,
  ).length
  const skippedGroups = preview.groups.length - activeGroups.length

  const canCommit =
    preview.parseErrors.length === 0 &&
    preview.unresolvedSiteCodes.length === 0 &&
    unmatchedAssets === 0 &&
    duplicateWOs === 0 &&
    activeGroups.every((g) => g.frequency !== null && g.jobPlanId !== null) &&
    activeGroups.length > 0

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Rows parsed" value={preview.parsedRowCount.toString()} />
        <Stat
          label="Groups"
          value={
            skippedGroups > 0
              ? `${activeGroups.length} / ${preview.groups.length}`
              : activeGroups.length.toString()
          }
          tone={skippedGroups > 0 ? 'warn' : 'neutral'}
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
            with the matching <code>code</code>, then re-parse.
          </p>
        </Banner>
      )}

      {/* Group list */}
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-eq-grey uppercase tracking-wide">
          {activeGroups.length} Maintenance Check{activeGroups.length === 1 ? '' : 's'} to be created
          {skippedGroups > 0 && (
            <span className="text-eq-grey font-normal normal-case">
              {' '}
              · {skippedGroups} skipped
            </span>
          )}
        </h2>
        {preview.groups.map((g) => (
          <GroupCard
            key={g.key}
            group={g}
            importSessionId={preview.importSessionId}
            onChanged={onReparse}
            isBusy={isPending}
          />
        ))}
      </div>

      {/* Commit bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 -mx-4 md:-mx-0 px-4 md:px-0 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-eq-grey">
          {canCommit
            ? `Ready to commit — ${activeGroups.length} check${activeGroups.length === 1 ? '' : 's'} · ${totalAssets} asset${totalAssets === 1 ? '' : 's'}.`
            : 'Resolve the flagged items above before committing. Use the inline buttons to link, create, or skip.'}
        </p>
        <Button
          size="sm"
          disabled={!canCommit || isCommitting || isPending}
          onClick={onCommit}
          title={canCommit ? 'Create maintenance checks from this file' : 'Resolve warnings before committing'}
        >
          {isCommitting ? 'Committing…' : 'Commit import'}
        </Button>
      </div>

      <p className="text-[10px] text-eq-grey">
        Import session: <code>{preview.importSessionId.slice(0, 8)}…</code> ·{' '}
        <span title={file.name}>{file.name}</span>
      </p>
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
          {(summary.groupsSkipped > 0 || summary.rowsSkipped > 0) && (
            <span className="text-eq-grey font-normal">
              {' '}
              (Skipped {summary.groupsSkipped} group{summary.groupsSkipped === 1 ? '' : 's'}
              {' '}and {summary.rowsSkipped} row{summary.rowsSkipped === 1 ? '' : 's'}.)
            </span>
          )}
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
  importSessionId,
  onChanged,
  isBusy,
}: {
  group: PreviewGroup
  importSessionId: string
  onChanged: () => void
  isBusy: boolean
}) {
  const [open, setOpen] = useState(
    !group.jobPlanId || group.unmatchedAssetCount > 0 || !group.siteId,
  )

  const hasHardIssue =
    !group.skipped &&
    (!group.siteId ||
      !group.jobPlanId ||
      !group.frequency ||
      group.unmatchedAssetCount > 0 ||
      group.duplicateWorkOrderCount > 0)

  return (
    <div
      className={`border rounded-lg bg-white overflow-hidden ${
        group.skipped
          ? 'border-gray-300 opacity-60'
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
            <span className="text-sm font-bold text-eq-ink">{group.siteCode}</span>
            <span className="text-eq-grey">·</span>
            <span className="text-sm font-mono text-eq-deep">{group.jobPlanCode}</span>
            {group.skipped && <Badge tone="error">skipped</Badge>}
            {group.matchSource === 'alias' && !group.skipped && (
              <Badge tone="info">alias: {group.jobPlanCodeRaw}</Badge>
            )}
            {group.matchSource === 'override' && !group.skipped && (
              <Badge tone="info">override</Badge>
            )}
            {group.matchSource === 'fuzzy' && group.fuzzyCandidate && !group.skipped && (
              <Badge tone="warn">
                fuzzy: {group.jobPlanCodeRaw} → {group.fuzzyCandidate.code}
              </Badge>
            )}
            {group.matchSource === 'none' && !group.skipped && (
              <Badge tone="error">no match</Badge>
            )}
            <span className="text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">
              {group.frequency ?? `(unknown: ${group.frequencySuffix})`}
            </span>
            <span className="text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">{group.startDate}</span>
          </div>
          <div className="text-xs text-eq-grey mt-0.5">
            {group.assetCount} asset{group.assetCount === 1 ? '' : 's'}
            {!group.skipped && group.unmatchedAssetCount > 0 && (
              <>
                {' · '}
                <span className="text-amber-700">
                  {group.unmatchedAssetCount} unmatched
                </span>
              </>
            )}
            {!group.skipped && group.duplicateWorkOrderCount > 0 && (
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

        <StatusIcon skipped={group.skipped} hasIssue={hasHardIssue} />
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

          <GroupFixToolbar
            group={group}
            importSessionId={importSessionId}
            onChanged={onChanged}
            isBusy={isBusy}
          />

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
                  <th className="px-3 py-2 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.assets.map((a) => (
                  <AssetRow
                    key={a.rowNumber}
                    asset={a}
                    siteId={group.siteId}
                    siteName={group.siteName}
                    importSessionId={importSessionId}
                    onChanged={onChanged}
                    isBusy={isBusy}
                    groupSkipped={group.skipped}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Group-level fix toolbar (fuzzy / no-match / skip / undo) ───────────

function GroupFixToolbar({
  group,
  importSessionId,
  onChanged,
  isBusy,
}: {
  group: PreviewGroup
  importSessionId: string
  onChanged: () => void
  isBusy: boolean
}) {
  const [showCreatePlan, setShowCreatePlan] = useState(false)
  const [busy, startTx] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // Nothing to offer at group level if everything already matched and not skipped.
  const hasGroupFix =
    group.skipped ||
    group.matchSource === 'override' ||
    group.matchSource === 'alias' ||
    group.matchSource === 'fuzzy' ||
    group.matchSource === 'none' ||
    !group.jobPlanId

  if (!hasGroupFix) return null

  function run(fn: () => Promise<{ success: true } | { success: true; data?: unknown } | { success: false; error: string }>) {
    setErr(null)
    startTx(async () => {
      const r = await fn()
      if (!r.success) {
        setErr(r.error)
        return
      }
      onChanged()
    })
  }

  return (
    <div className="px-4 py-2 border-b border-gray-200 bg-white flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold text-eq-grey uppercase tracking-wide mr-1">
        Group actions
      </span>

      {group.skipped ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || isBusy}
          onClick={() =>
            run(() =>
              clearOverrideAction({ importSessionId, groupKey: group.key }),
            )
          }
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Undo skip
        </Button>
      ) : (
        <>
          {group.matchSource === 'fuzzy' && group.fuzzyCandidate && group.jobPlanId === null && (
            <Button
              size="sm"
              disabled={busy || isBusy}
              onClick={() => {
                // Fuzzy match: the suggested code's jobPlanId isn't on the
                // group yet (by design), so we have to look it up. The
                // simplest path is: call acceptAliasAction with the
                // suggested code. But acceptAliasAction needs the jobPlanId,
                // which we don't have in PreviewGroup. For now, surface a
                // small prompt that also works as "Create job plan" entry.
                setErr(
                  `Click "Create job plan" or open Job Plans to add "${group.fuzzyCandidate!.code}" first, then re-parse.`,
                )
              }}
              title="Confirm the fuzzy suggestion"
            >
              <Link2 className="w-3.5 h-3.5 mr-1" />
              Accept &ldquo;{group.fuzzyCandidate.code}&rdquo;
            </Button>
          )}
          {group.matchSource === 'override' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || isBusy}
              onClick={() =>
                run(() =>
                  clearOverrideAction({ importSessionId, groupKey: group.key }),
                )
              }
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Undo
            </Button>
          )}
          {(!group.jobPlanId || group.matchSource === 'fuzzy') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || isBusy}
              onClick={() => setShowCreatePlan(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Create job plan
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || isBusy}
            onClick={() =>
              run(() => skipGroupAction({ importSessionId, groupKey: group.key }))
            }
          >
            <CircleSlash className="w-3.5 h-3.5 mr-1" />
            Skip group
          </Button>
        </>
      )}

      {err && <span className="text-xs text-red-600 ml-2">{err}</span>}

      {/* Also offer accept-alias when fuzzy, once we have a concrete jpId */}
      {group.matchSource === 'fuzzy' && group.fuzzyCandidate && group.jobPlanId && (
        <Button
          size="sm"
          disabled={busy || isBusy}
          onClick={() =>
            run(() =>
              acceptAliasAction({
                importSessionId,
                groupKey: group.key,
                externalCode: group.jobPlanCodeRaw,
                jobPlanId: group.jobPlanId!,
              }),
            )
          }
        >
          <Link2 className="w-3.5 h-3.5 mr-1" />
          Accept alias {group.jobPlanCodeRaw} → {group.fuzzyCandidate.code}
        </Button>
      )}

      {showCreatePlan && (
        <CreateJobPlanDialog
          onClose={() => setShowCreatePlan(false)}
          importSessionId={importSessionId}
          groupKey={group.key}
          defaults={{ code: group.jobPlanCodeRaw, name: group.jobPlanCodeRaw }}
          onCreated={() => {
            setShowCreatePlan(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

// ── Asset row with inline fixes ─────────────────────────────────────────

function AssetRow({
  asset,
  siteId,
  siteName,
  importSessionId,
  onChanged,
  isBusy,
  groupSkipped,
}: {
  asset: PreviewAsset
  siteId: string | null
  siteName: string | null
  importSessionId: string
  onChanged: () => void
  isBusy: boolean
  groupSkipped: boolean
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, startTx] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function run(fn: () => Promise<{ success: true } | { success: true; data?: unknown } | { success: false; error: string }>) {
    setErr(null)
    startTx(async () => {
      const r = await fn()
      if (!r.success) {
        setErr(r.error)
        return
      }
      onChanged()
    })
  }

  function handlePick(hit: AssetSearchHit) {
    setShowPicker(false)
    run(() =>
      linkAssetToRowAction({
        importSessionId,
        rowNumber: asset.rowNumber,
        assetId: hit.id,
      }),
    )
  }

  const rowCls = asset.skipped
    ? 'border-t border-gray-100 bg-gray-100 text-eq-grey line-through'
    : 'border-t border-gray-100 bg-white'

  return (
    <>
      <tr className={rowCls}>
        <td className="px-3 py-1.5 text-eq-grey">{asset.rowNumber}</td>
        <td className="px-3 py-1.5 font-mono">
          {asset.workOrder}
          {asset.duplicateWorkOrder && (
            <span className="ml-1.5 text-amber-700">(dup)</span>
          )}
        </td>
        <td className="px-3 py-1.5 font-mono">{asset.maximoAssetId}</td>
        <td className="px-3 py-1.5 text-eq-ink">{asset.description || '—'}</td>
        <td className="px-3 py-1.5 text-eq-grey">{asset.location ?? '—'}</td>
        <td className="px-3 py-1.5">
          {asset.skipped ? (
            <span className="inline-flex items-center gap-1 text-eq-grey">
              <CircleSlash className="w-3.5 h-3.5" />
              skipped
            </span>
          ) : asset.resolvedAssetId ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {asset.resolvedAssetName ?? asset.resolvedAssetId}
              {asset.resolvedFrom === 'override' && (
                <span className="text-[10px] uppercase tracking-wide text-eq-deep ml-1">
                  (override)
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              no match
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right whitespace-nowrap">
          {groupSkipped ? (
            <span className="text-[10px] text-eq-grey">group skipped</span>
          ) : asset.skipped ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || isBusy}
              onClick={() =>
                run(() =>
                  clearOverrideAction({
                    importSessionId,
                    rowNumber: asset.rowNumber,
                  }),
                )
              }
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Undo
            </Button>
          ) : (
            <div className="inline-flex items-center gap-1">
              {(!asset.resolvedAssetId || asset.resolvedFrom === 'override') && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || isBusy || !siteId}
                    onClick={() => setShowPicker(true)}
                    title={!siteId ? 'Site not resolved yet' : 'Link to an existing EQ asset'}
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1" />
                    Link
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || isBusy || !siteId}
                    onClick={() => setShowCreate(true)}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Create
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || isBusy}
                onClick={() =>
                  run(() =>
                    skipRowAction({
                      importSessionId,
                      rowNumber: asset.rowNumber,
                    }),
                  )
                }
              >
                <CircleSlash className="w-3.5 h-3.5 mr-1" />
                Skip
              </Button>
              {asset.resolvedFrom === 'override' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || isBusy}
                  onClick={() =>
                    run(() =>
                      clearOverrideAction({
                        importSessionId,
                        rowNumber: asset.rowNumber,
                      }),
                    )
                  }
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {err && (
        <tr className="bg-red-50">
          <td colSpan={7} className="px-3 py-1 text-xs text-red-700">
            {err}
          </td>
        </tr>
      )}
      {asset.warnings.length > 0 && !asset.skipped && (
        <tr className="bg-amber-50/40">
          <td colSpan={7} className="px-3 py-1 text-[10px] text-amber-800">
            {asset.warnings.join(' · ')}
          </td>
        </tr>
      )}
      {showPicker && (
        <AssetPicker
          onClose={() => setShowPicker(false)}
          siteId={siteId}
          siteName={siteName}
          initialQuery={asset.maximoAssetId}
          onPick={handlePick}
        />
      )}
      {showCreate && (
        <CreateAssetDialog
          onClose={() => setShowCreate(false)}
          importSessionId={importSessionId}
          rowNumber={asset.rowNumber}
          siteId={siteId}
          siteName={siteName}
          defaults={{
            maximoId: asset.maximoAssetId,
            description: asset.description,
            location: asset.location,
          }}
          onCreated={() => {
            setShowCreate(false)
            onChanged()
          }}
        />
      )}
    </>
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

function StatusIcon({ hasIssue, skipped }: { hasIssue: boolean; skipped?: boolean }) {
  if (skipped) return <CircleSlash className="w-4 h-4 text-eq-grey shrink-0" />
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
