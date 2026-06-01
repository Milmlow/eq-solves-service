'use client'

/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /maintenance/paste — paste-to-table check creation.
 *
 * Minimum inputs: asset Maximo ID + work order number.
 * Site, location, and job plan are inferred from the matched asset.
 * User sets date and frequency once for the whole batch.
 *
 * Flow: Paste → Configure → Review → Done
 */

import { useState, useCallback, useId } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, ClipboardPaste, ArrowRight, Loader2, ExternalLink } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FREQUENCY_OPTIONS } from '@/lib/import/paste-constants'
import {
  lookupPasteRowsAction,
  commitPasteImportAction,
  type PasteInputRow,
  type ResolvedRow,
  type UnresolvedRow,
  type CommitPasteInput,
} from './actions'

// ── Clipboard parser ──────────────────────────────────────────────────────

interface ParsedPaste {
  rows: PasteInputRow[]
  assetColLabel: string
  woColLabel: string
  headerDetected: boolean
  skipped: number
}

function parseClipboardText(raw: string): ParsedPaste {
  const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) {
    return { rows: [], assetColLabel: '', woColLabel: '', headerDetected: false, skipped: 0 }
  }

  // Detect separator
  const sep = lines[0].includes('\t') ? '\t' : ','
  const cells = lines.map((l) =>
    l.split(sep).map((c) => c.trim().replace(/^["']|["']$/g, '')),
  )

  // Normalise a header cell for matching
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

  const firstRow = cells[0].map(norm)

  // Possible header names for each field
  const ASSET_KEYS = ['asset', 'assetid', 'assetno', 'maximoid', 'maximo', 'assetnum']
  const WO_KEYS    = ['workorder', 'wo', 'workordr', 'workorderno', 'workordernum', 'wono']

  const assetColIdx = firstRow.findIndex((h) => ASSET_KEYS.includes(h))
  const woColIdx    = firstRow.findIndex((h) => WO_KEYS.some((k) => h.startsWith(k)))

  const hasHeaders = assetColIdx >= 0 && woColIdx >= 0
  const aIdx = hasHeaders ? assetColIdx : 4   // fallback: 5th col (typical Maximo summary email)
  const wIdx = hasHeaders ? woColIdx    : 1   // fallback: 2nd col

  const assetColLabel = hasHeaders ? cells[0][aIdx] : `Column ${aIdx + 1}`
  const woColLabel    = hasHeaders ? cells[0][wIdx]  : `Column ${wIdx + 1}`

  const dataRows = hasHeaders ? cells.slice(1) : cells

  let skipped = 0
  const rows: PasteInputRow[] = []

  for (const row of dataRows) {
    const maximoAssetId = row[aIdx]?.trim() ?? ''
    const workOrder     = row[wIdx]?.trim() ?? ''
    if (!maximoAssetId || !workOrder) { skipped++; continue }
    // Skip header-like rows that sneak through (e.g. "Asset", "Work Order")
    if (ASSET_KEYS.includes(norm(maximoAssetId))) { skipped++; continue }
    rows.push({ maximoAssetId, workOrder })
  }

  return { rows, assetColLabel, woColLabel, headerDetected: hasHeaders, skipped }
}

// ── Column override picker ────────────────────────────────────────────────

function ColumnPicker({
  label,
  value,
  onChange,
  maxCols,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  maxCols: number
}) {
  const id = useId()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-eq-grey w-28">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-gray-300 px-2 py-1 text-sm text-eq-ink focus:outline-none focus:ring-2 focus:ring-eq-sky"
      >
        {Array.from({ length: maxCols }, (_, i) => (
          <option key={i} value={i}>Column {i + 1}</option>
        ))}
      </select>
    </label>
  )
}

// ── Steps ─────────────────────────────────────────────────────────────────

type Step = 'paste' | 'configure' | 'review' | 'done'

// ── Today ISO ────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function PastePage() {
  const [step, setStep] = useState<Step>('paste')

  // Paste step
  const [rawText, setRawText]           = useState('')
  const [parsed, setParsed]             = useState<ParsedPaste | null>(null)
  const [assetColOverride, setAssetCol] = useState<number | null>(null)
  const [woColOverride, setWoCol]       = useState<number | null>(null)
  const [showColPicker, setShowColPicker] = useState(false)

  // Configure step
  const [targetDate, setTargetDate] = useState(todayISO)
  const [frequency, setFrequency]   = useState<string>('annual')
  const [customName, setCustomName] = useState('')

  // Review step
  const [looking, setLooking]       = useState(false)
  const [resolved, setResolved]     = useState<ResolvedRow[]>([])
  const [unresolved, setUnresolved] = useState<UnresolvedRow[]>([])
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Commit step
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [summary, setSummary]       = useState<{
    checksCreated: number
    checkAssetsCreated: number
    checks: { checkId: string; siteName: string; assetCount: number; taskCount: number }[]
  } | null>(null)

  // ── Parse ────────────────────────────────────────────────────────────

  const handleParse = useCallback(() => {
    if (!rawText.trim()) return
    const result = parseClipboardText(rawText)
    // Apply manual column overrides if set
    if (assetColOverride !== null || woColOverride !== null) {
      // Re-parse with overrides
      const lines = rawText.trim().split(/\r?\n/).filter((l) => l.trim())
      const sep   = lines[0].includes('\t') ? '\t' : ','
      const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^["']|["']$/g, '')))
      const aIdx  = assetColOverride  ?? result.assetColLabel.startsWith('Column')
        ? parseInt(result.assetColLabel.replace('Column ', '')) - 1
        : 4
      const wIdx  = woColOverride ?? (result.woColLabel.startsWith('Column')
        ? parseInt(result.woColLabel.replace('Column ', '')) - 1
        : 1)
      let skipped = 0
      const overrideRows: PasteInputRow[] = []
      for (const row of cells) {
        const maximoAssetId = row[aIdx]?.trim() ?? ''
        const workOrder     = row[wIdx]?.trim() ?? ''
        if (!maximoAssetId || !workOrder) { skipped++; continue }
        overrideRows.push({ maximoAssetId, workOrder })
      }
      setParsed({ ...result, rows: overrideRows, skipped })
    } else {
      setParsed(result)
    }
    setStep('configure')
  }, [rawText, assetColOverride, woColOverride])

  // ── Lookup ───────────────────────────────────────────────────────────

  const handleLookup = useCallback(async () => {
    if (!parsed) return
    setLooking(true)
    setLookupError(null)
    try {
      const result = await lookupPasteRowsAction(parsed.rows)
      if (!result.success) { setLookupError(result.error); setLooking(false); return }
      setResolved(result.resolved)
      setUnresolved(result.unresolved)
      setStep('review')
    } catch (e) {
      setLookupError((e as Error).message)
    } finally {
      setLooking(false)
    }
  }, [parsed])

  // ── Commit ───────────────────────────────────────────────────────────

  const handleCommit = useCallback(async () => {
    if (resolved.length === 0) return
    const hasDupes = resolved.some((r) => r.duplicateWorkOrder)
    if (hasDupes) return          // button disabled, but guard anyway

    setCommitting(true)
    setCommitError(null)

    const input: CommitPasteInput = {
      rows: resolved.map((r) => ({
        assetId:   r.assetId,
        workOrder: r.workOrder,
        siteId:    r.siteId,
        siteName:  r.siteName,
        jobPlanId: r.jobPlanId,
      })),
      targetDate,
      frequency: frequency as CommitPasteInput['frequency'],
      customName: customName.trim() || undefined,
    }

    try {
      const result = await commitPasteImportAction(input)
      if (!result.success) { setCommitError(result.error); setCommitting(false); return }
      if (result.data) setSummary(result.data)
      setStep('done')
    } catch (e) {
      setCommitError((e as Error).message)
    } finally {
      setCommitting(false)
    }
  }, [resolved, targetDate, frequency, customName])

  // ── Reset ────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep('paste')
    setRawText('')
    setParsed(null)
    setAssetCol(null)
    setWoCol(null)
    setShowColPicker(false)
    setResolved([])
    setUnresolved([])
    setLookupError(null)
    setCommitError(null)
    setSummary(null)
    setTargetDate(todayISO())
    setFrequency('annual')
    setCustomName('')
  }, [])

  // ── Derived ──────────────────────────────────────────────────────────

  const hasDupes   = resolved.some((r) => r.duplicateWorkOrder)
  const canCommit  = resolved.length > 0 && !hasDupes

  // Sites that will be created
  const siteSummary = [...new Map(
    resolved.map((r) => [r.siteId, r.siteName]),
  ).entries()]

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home',        href: '/dashboard' },
            { label: 'Do',          href: '/do' },
            { label: 'Paste import' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-ink mt-2">Paste work orders</h1>
        <p className="text-sm text-eq-grey mt-1">
          Paste a table from an email or spreadsheet — only Asset ID and Work Order columns are required.
        </p>
      </div>

      {/* ── Step indicator ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-eq-grey">
        {(['paste', 'configure', 'review', 'done'] as Step[]).map((s, i, arr) => (
          <span key={s} className="flex items-center gap-2">
            <span className={`font-semibold capitalize ${step === s ? 'text-eq-sky' : step === 'done' || arr.indexOf(step) > i ? 'text-eq-ink' : ''}`}>
              {s === 'configure' ? 'Configure' : s === 'paste' ? 'Paste' : s === 'review' ? 'Review' : 'Done'}
            </span>
            {i < arr.length - 1 && <ArrowRight className="w-3 h-3" />}
          </span>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Step 1 — Paste                                               */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {step === 'paste' && (
        <Card className="space-y-4">
          <div className="flex items-center gap-2 text-eq-deep">
            <ClipboardPaste className="w-5 h-5" />
            <span className="font-semibold text-sm">Paste your table here</span>
          </div>

          <p className="text-xs text-eq-grey">
            Copy from an email, Excel, or any app and paste below. Columns are auto-detected —
            we look for <strong>Asset</strong> and <strong>Work Order</strong> headers.
            If your table has no headers, Asset is assumed to be column 5 and Work Order column 2
            (matching the standard Maximo summary email). You can override below.
          </p>

          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-eq-ink placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky resize-y min-h-[160px]"
            placeholder={"Site\tWork Order\tDescription\tClassification\tAsset\tStatus\tWork Type\tJob Plan\nAU01-SY7\t4346855\tSY7-LVSB-…\tELEC\\ATS\t1314\tINPRG\tPM\tATS-A"}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onPaste={(e) => {
              // Let the paste land, then auto-advance
              setTimeout(() => {
                const text = e.currentTarget.value
                if (text.trim()) {
                  setRawText(text)
                }
              }, 0)
            }}
          />

          {/* Column overrides */}
          <div>
            <button
              type="button"
              onClick={() => setShowColPicker((v) => !v)}
              className="text-xs text-eq-sky underline underline-offset-2"
            >
              {showColPicker ? 'Hide column overrides' : 'Override column positions'}
            </button>
            {showColPicker && (
              <div className="mt-3 space-y-2 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-eq-grey mb-2">
                  If auto-detection picks the wrong columns, set them manually (1-based).
                </p>
                <ColumnPicker
                  label="Asset ID column"
                  value={assetColOverride ?? 4}
                  onChange={setAssetCol}
                  maxCols={20}
                />
                <ColumnPicker
                  label="Work Order column"
                  value={woColOverride ?? 1}
                  onChange={setWoCol}
                  maxCols={20}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={handleParse}
              disabled={!rawText.trim()}
            >
              Parse →
            </Button>
          </div>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Step 2 — Configure                                           */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {step === 'configure' && parsed && (
        <div className="space-y-4">
          {/* Detected rows summary */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-eq-ink">
                {parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''} detected
              </span>
              <button
                type="button"
                onClick={() => setStep('paste')}
                className="text-xs text-eq-sky underline underline-offset-2"
              >
                ← Back to paste
              </button>
            </div>

            {/* Column detection result */}
            <div className="flex gap-4 text-xs text-eq-grey">
              <span>
                Asset column: <strong className="text-eq-ink">{parsed.assetColLabel}</strong>
                {!parsed.headerDetected && ' (inferred)'}
              </span>
              <span>
                Work Order column: <strong className="text-eq-ink">{parsed.woColLabel}</strong>
                {!parsed.headerDetected && ' (inferred)'}
              </span>
              {parsed.skipped > 0 && (
                <span className="text-amber-600">{parsed.skipped} blank row(s) skipped</span>
              )}
            </div>

            {/* Preview table — first 5 rows */}
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold text-eq-grey">Asset ID</th>
                    <th className="px-3 py-2 text-left font-semibold text-eq-grey">Work Order</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-eq-ink">{row.maximoAssetId}</td>
                      <td className="px-3 py-1.5 font-mono text-eq-ink">{row.workOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 5 && (
                <p className="px-3 py-2 text-xs text-eq-grey">
                  + {parsed.rows.length - 5} more row{parsed.rows.length - 5 !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {parsed.rows.length === 0 && (
              <p className="text-sm text-red-600">
                No rows extracted. Check your column positions and try again.
              </p>
            )}
          </Card>

          {/* Date + frequency */}
          <Card className="space-y-4">
            <p className="text-sm font-semibold text-eq-ink">Configure the check</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-eq-grey uppercase tracking-wider">
                  Target date
                </span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-eq-ink focus:outline-none focus:ring-2 focus:ring-eq-sky"
                />
                <p className="text-xs text-eq-grey">Applied to all assets in this batch.</p>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-eq-grey uppercase tracking-wider">
                  Frequency
                </span>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-eq-ink focus:outline-none focus:ring-2 focus:ring-eq-sky"
                >
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-eq-grey">Determines which job plan tasks are included.</p>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-eq-grey uppercase tracking-wider">
                Check name <span className="font-normal normal-case">(optional)</span>
              </span>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="SY7 — June 2026"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-eq-ink placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky"
              />
              <p className="text-xs text-eq-grey">Defaults to Site — Month Year if left blank.</p>
            </label>
          </Card>

          {lookupError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {lookupError}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('paste')}>← Back</Button>
            <Button
              variant="primary"
              onClick={() => void handleLookup()}
              disabled={parsed.rows.length === 0 || looking || !targetDate}
            >
              {looking
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Looking up assets…</>
                : 'Look up assets →'
              }
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Step 3 — Review                                              */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* Summary bar */}
          <Card>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-2xl font-bold text-eq-ink tabular-nums">{resolved.length}</p>
                <p className="text-xs text-eq-grey">matched</p>
              </div>
              {unresolved.length > 0 && (
                <div>
                  <p className="text-2xl font-bold text-amber-600 tabular-nums">{unresolved.length}</p>
                  <p className="text-xs text-eq-grey">not found</p>
                </div>
              )}
              {hasDupes && (
                <div>
                  <p className="text-2xl font-bold text-red-600 tabular-nums">
                    {resolved.filter((r) => r.duplicateWorkOrder).length}
                  </p>
                  <p className="text-xs text-eq-grey">duplicate WOs</p>
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-eq-ink">
                  {targetDate} · {FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label}
                </p>
                <p className="text-xs text-eq-grey">
                  {siteSummary.length} site{siteSummary.length !== 1 ? 's' : ''}
                  {' — '}
                  {siteSummary.map(([, name]) => name).join(', ')}
                </p>
              </div>
            </div>
          </Card>

          {/* Duplicate WO blocker */}
          {hasDupes && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 flex gap-2 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {resolved.filter((r) => r.duplicateWorkOrder).length} work order(s) already exist in EQ.
                Remove them from your paste and re-import, or they will block the commit.
              </span>
            </div>
          )}

          {/* Matched rows */}
          {resolved.length > 0 && (
            <Card className="space-y-2">
              <p className="text-xs font-semibold text-eq-grey uppercase tracking-wider">Matched assets</p>
              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-semibold text-eq-grey">Asset</th>
                      <th className="px-3 py-2 text-left font-semibold text-eq-grey">Site</th>
                      <th className="px-3 py-2 text-left font-semibold text-eq-grey">Job Plan</th>
                      <th className="px-3 py-2 text-left font-semibold text-eq-grey">Work Order</th>
                      <th className="px-3 py-2 text-left font-semibold text-eq-grey"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolved.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-gray-100 last:border-0 ${
                          row.duplicateWorkOrder ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="px-3 py-1.5 text-eq-ink">
                          <span className="font-medium">{row.assetName}</span>
                          <span className="ml-1.5 font-mono text-eq-grey">{row.maximoAssetId}</span>
                        </td>
                        <td className="px-3 py-1.5 text-eq-grey">{row.siteName}</td>
                        <td className="px-3 py-1.5 text-eq-grey">{row.jobPlanCode ?? '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-eq-ink">{row.workOrder}</td>
                        <td className="px-3 py-1.5">
                          {row.duplicateWorkOrder
                            ? <span className="text-red-600 font-semibold">Duplicate WO</span>
                            : <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Unresolved rows */}
          {unresolved.length > 0 && (
            <Card className="space-y-2">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                Not found — will be skipped
              </p>
              <div className="overflow-x-auto rounded border border-amber-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-amber-50 border-b border-amber-200">
                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Asset ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Work Order</th>
                      <th className="px-3 py-2 text-left font-semibold text-amber-700">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unresolved.map((row, i) => (
                      <tr key={i} className="border-b border-amber-100 last:border-0">
                        <td className="px-3 py-1.5 font-mono text-eq-ink">{row.maximoAssetId}</td>
                        <td className="px-3 py-1.5 font-mono text-eq-ink">{row.workOrder}</td>
                        <td className="px-3 py-1.5 text-amber-700">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-eq-grey">
                These assets aren't in EQ yet. Add them via{' '}
                <Link href="/assets" className="text-eq-sky underline underline-offset-2">Assets</Link>{' '}
                or via the xlsx import wizard which supports inline creation.
              </p>
            </Card>
          )}

          {commitError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {commitError}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('configure')}>← Back</Button>
            <Button
              variant="primary"
              onClick={() => void handleCommit()}
              disabled={!canCommit || committing}
            >
              {committing
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating checks…</>
                : `Create ${siteSummary.length} check${siteSummary.length !== 1 ? 's' : ''}`
              }
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Step 4 — Done                                                */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {step === 'done' && summary && (
        <Card className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-eq-ink">
                {summary.checksCreated} check{summary.checksCreated !== 1 ? 's' : ''} created
              </p>
              <p className="text-xs text-eq-grey">
                {summary.checkAssetsCreated} asset{summary.checkAssetsCreated !== 1 ? 's' : ''} across{' '}
                {summary.checksCreated} site{summary.checksCreated !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {summary.checks.map((c) => (
              <Link
                key={c.checkId}
                href={`/maintenance/${c.checkId}`}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-eq-sky transition-colors group"
              >
                <div>
                  <p className="text-sm font-semibold text-eq-ink">{c.siteName}</p>
                  <p className="text-xs text-eq-grey">
                    {c.assetCount} asset{c.assetCount !== 1 ? 's' : ''} · {c.taskCount} task{c.taskCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-eq-grey group-hover:text-eq-sky transition-colors" />
              </Link>
            ))}
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={reset}>Paste another batch</Button>
            <Link href="/maintenance">
              <Button variant="primary">Go to maintenance</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}
