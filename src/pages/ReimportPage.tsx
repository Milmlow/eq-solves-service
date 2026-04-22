import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Info,
  Upload,
  X,
} from 'lucide-react'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { useCapturer } from '../hooks/useCapturer'
import { supabase } from '../lib/supabase'
import {
  extractCapturesFromFilledTemplate,
  type ReimportResult,
} from '../lib/reimport'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { MetaRow } from '../components/ui/MetaRow'
import { Pill } from '../components/ui/Pill'
import { ProgressBar } from '../components/ui/ProgressBar'

// ============================================================================
// Re-import a filled Equinix capture template.
//
// Flow the tech sees:
//   1. Drop filled .xlsm/.xlsx on this page.
//   2. We parse it offline and show a preview — "X rows matched, Y captures
//      detected, Z unmatched" — BEFORE writing anything.
//   3. Tech clicks "Write captures" to upsert, stamped source='file_reimport'
//      + source_file=<filename>.
//
// Why this page exists (vs the per-asset UI): at scale, typing into 120
// switchboards in the web form is slow. The Equinix template already has the
// green cells laid out; doing the capture there and re-importing in one shot
// is faster and keeps the filled workbook as a signed audit artefact.
// ============================================================================

export function ReimportPage({ jobRef }: { jobRef: string }) {
  const { job } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)
  const { name: capturerName } = useCapturer()

  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<ReimportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [writeSummary, setWriteSummary] = useState<{
    rowsWritten: number
    at: string
  } | null>(null)

  // ─── Parse on file select ────────────────────────────────────────────────
  const onFileSelected = async (f: File | null) => {
    setFile(f)
    setResult(null)
    setParseError(null)
    setWriteError(null)
    setWriteSummary(null)
    if (!f) return
    if (!assets.length || !fields.length) {
      setParseError(
        'Still loading the job — wait a moment and re-drop the file.',
      )
      return
    }
    setParsing(true)
    try {
      const r = await extractCapturesFromFilledTemplate({
        file: f,
        assets,
        fields,
      })
      setResult(r)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }

  // ─── Write captures to Supabase ──────────────────────────────────────────
  const write = async () => {
    if (!result || !file || !job) return
    setWriteError(null)
    setWriting(true)
    try {
      const nowIso = new Date().toISOString()
      const rows = result.values.map((v) => ({
        asset_id: v.asset_id,
        classification_field_id: v.classification_field_id,
        value: v.value,
        captured_by: capturerName ?? null,
        captured_at: nowIso,
        notes: null,
        flagged: false,
        source: 'file_reimport' as const,
        source_file: file.name,
      }))
      if (!rows.length) {
        throw new Error('Nothing to write — no captured cells found.')
      }
      // Chunk upserts so we don't hit payload limits on big jobs.
      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK)
        const { error } = await supabase
          .from('captures')
          .upsert(slice as never, {
            onConflict: 'asset_id,classification_field_id',
          })
        if (error) throw error
      }
      setWriteSummary({ rowsWritten: rows.length, at: nowIso })
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err))
    } finally {
      setWriting(false)
    }
  }

  // ─── Derived summary numbers ─────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!result) {
      return {
        rowsMatched: 0,
        totalRowsInSheet: 0,
        capturesDetected: 0,
        unmatchedRows: 0,
        unmatchedFields: 0,
      }
    }
    return {
      rowsMatched: result.rowsMatched,
      totalRowsInSheet: result.totalRowsInSheet,
      capturesDetected: result.values.length,
      unmatchedRows: result.unmatchedRows.length,
      unmatchedFields: result.unmatchedFields.length,
    }
  }, [result])

  const matchPct =
    summary.totalRowsInSheet > 0
      ? Math.round((summary.rowsMatched / summary.totalRowsInSheet) * 100)
      : 0

  // Group detected captures by field for the preview table
  const captureByField = useMemo(() => {
    if (!result) return [] as Array<{ spec_id: string; count: number }>
    const m = new Map<string, number>()
    for (const v of result.values) m.set(v.spec_id, (m.get(v.spec_id) ?? 0) + 1)
    return Array.from(m.entries())
      .map(([spec_id, count]) => ({ spec_id, count }))
      .sort((a, b) => b.count - a.count)
  }, [result])

  const canWrite =
    !!result && summary.capturesDetected > 0 && !writing && !writeSummary

  return (
    <div className="max-w-[1100px] mx-auto">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}
      >
        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-3.5 min-w-0">
          {/* Drop zone */}
          <Card padding={0}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-[14px] font-bold text-ink">
                  Filled Equinix template
                </div>
                <div className="text-[12px] text-muted mt-0.5">
                  Drop the template the tech filled offline — we'll preview
                  matches before writing anything.
                </div>
              </div>
              {file && result && !parseError && (
                <Pill tone="ok" size="sm">
                  <Check size={10} strokeWidth={2.5} />
                  Parsed
                </Pill>
              )}
              {parsing && (
                <Pill tone="info" size="sm">
                  Parsing…
                </Pill>
              )}
            </div>
            <div className="p-4">
              <label
                className={
                  'flex items-center gap-3 rounded-lg border-2 border-dashed ' +
                  (file
                    ? result && !parseError
                      ? 'border-ok bg-ok-bg'
                      : parseError
                        ? 'border-bad bg-bad-bg'
                        : 'border-gray-300 bg-gray-50'
                    : 'border-gray-300 bg-gray-50 hover:border-sky') +
                  ' px-4 py-3.5 cursor-pointer transition-colors'
                }
              >
                <div
                  className={
                    'flex items-center justify-center h-9 w-9 rounded-md shrink-0 ' +
                    (file && result && !parseError
                      ? 'bg-white text-ok-fg'
                      : 'bg-white text-sky-deep')
                  }
                >
                  <FileUp size={16} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink truncate">
                    {file ? file.name : 'Click to upload .xlsm / .xlsx'}
                  </div>
                  <div className="text-[11px] text-muted">
                    {file
                      ? `${Math.round(file.size / 1024)} KB${
                          result
                            ? ` · ${result.greenCellsSeen} captures detected`
                            : parsing
                              ? ' · parsing'
                              : ''
                        }`
                      : 'We read the green cells on the Assets sheet, match rows, and stage captures.'}
                  </div>
                </div>
                {file && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      onFileSelected(null)
                    }}
                    className="shrink-0 text-muted hover:text-bad-fg transition-colors"
                    aria-label="Remove file"
                  >
                    <X size={16} strokeWidth={2} />
                  </button>
                )}
                <input
                  type="file"
                  accept=".xlsm,.xlsx"
                  className="hidden"
                  onChange={(e) =>
                    onFileSelected(e.target.files?.[0] ?? null)
                  }
                />
              </label>

              {parseError && (
                <div className="mt-3 flex items-start gap-2 text-[12px] text-bad-fg">
                  <AlertTriangle
                    size={14}
                    strokeWidth={2}
                    className="shrink-0 mt-[2px]"
                  />
                  <div className="min-w-0 break-words">{parseError}</div>
                </div>
              )}
            </div>
          </Card>

          {/* Match preview */}
          {result && (
            <Card padding={0}>
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-[14px] font-bold text-ink">
                  Match preview
                </div>
                <div className="text-[12px] text-muted mt-0.5">
                  What we'll upsert when you hit Write. Source =
                  <span className="font-mono"> file_reimport</span>.
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                <div className="flex items-center gap-2.5 px-4 py-2.5">
                  {summary.rowsMatched === summary.totalRowsInSheet ? (
                    <Check
                      size={15}
                      strokeWidth={2.5}
                      className="text-ok-fg shrink-0"
                    />
                  ) : (
                    <AlertTriangle
                      size={15}
                      strokeWidth={2}
                      className="text-warn-fg shrink-0"
                    />
                  )}
                  <div className="flex-1 text-[13px] text-ink">
                    Rows matched to DB assets
                  </div>
                  <span className="text-[12px] text-muted tabular-nums font-mono">
                    {summary.rowsMatched}/{summary.totalRowsInSheet}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 px-4 py-2.5">
                  {summary.unmatchedFields === 0 ? (
                    <Check
                      size={15}
                      strokeWidth={2.5}
                      className="text-ok-fg shrink-0"
                    />
                  ) : (
                    <AlertTriangle
                      size={15}
                      strokeWidth={2}
                      className="text-warn-fg shrink-0"
                    />
                  )}
                  <div className="flex-1 text-[13px] text-ink">
                    Green-cell columns mapped to fields
                  </div>
                  <span className="text-[12px] text-muted tabular-nums font-mono">
                    {captureByField.length}
                    {summary.unmatchedFields > 0 &&
                      ` · ${summary.unmatchedFields} unmapped`}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 px-4 py-2.5">
                  <Info
                    size={15}
                    strokeWidth={2}
                    className="text-sky-deep shrink-0"
                  />
                  <div className="flex-1 text-[13px] text-ink">
                    Captures to write
                  </div>
                  <span className="text-[12px] text-ink tabular-nums font-mono font-semibold">
                    {summary.capturesDetected}
                  </span>
                </div>
              </div>

              {/* By-field breakdown */}
              {captureByField.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100">
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted mb-2">
                    By field
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {captureByField.map((c) => (
                      <div
                        key={c.spec_id}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span className="font-mono text-ink truncate">
                          {c.spec_id}
                        </span>
                        <span className="font-mono text-muted tabular-nums">
                          {c.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Unmatched rows */}
          {result && result.unmatchedRows.length > 0 && (
            <Card padding={0}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-bold text-ink">
                    Unmatched rows
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">
                    These rows in the sheet didn't match any DB asset — they'll
                    be skipped. Check the template is for this job.
                  </div>
                </div>
                <Pill tone="warn" size="sm">
                  {result.unmatchedRows.length}
                </Pill>
              </div>
              <div className="divide-y divide-gray-100 max-h-[240px] overflow-y-auto">
                {result.unmatchedRows.slice(0, 50).map((r) => (
                  <div
                    key={r.row_number}
                    className="flex items-center gap-3 px-4 py-2 text-[12px]"
                  >
                    <span className="font-mono text-muted shrink-0 w-10">
                      r{r.row_number}
                    </span>
                    <span className="flex-1 text-ink truncate">{r.ref}</span>
                  </div>
                ))}
                {result.unmatchedRows.length > 50 && (
                  <div className="px-4 py-2 text-[11px] text-muted italic">
                    + {result.unmatchedRows.length - 50} more…
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Unmatched fields */}
          {result && result.unmatchedFields.length > 0 && (
            <Card padding={0}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-bold text-ink">
                    Unmapped columns
                  </div>
                  <div className="text-[12px] text-muted mt-0.5">
                    Green columns in the sheet with no matching classification
                    field — values in these columns won't be written.
                  </div>
                </div>
                <Pill tone="warn" size="sm">
                  {result.unmatchedFields.length}
                </Pill>
              </div>
              <div className="p-4 flex flex-wrap gap-1.5">
                {result.unmatchedFields.map((h) => (
                  <span
                    key={h}
                    className="px-2 py-[2px] rounded bg-gray-100 text-[11px] font-mono text-ink"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* How it works */}
          {!file && (
            <Card padding={0}>
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-[14px] font-bold text-ink">How it works</div>
              </div>
              <div className="p-4 text-[13px] text-ink leading-relaxed space-y-2">
                <div className="flex gap-2.5">
                  <span className="font-mono text-muted shrink-0 w-5">1.</span>
                  <span>
                    Tech fills green cells in the Equinix template offline and
                    saves the workbook.
                  </span>
                </div>
                <div className="flex gap-2.5">
                  <span className="font-mono text-muted shrink-0 w-5">2.</span>
                  <span>
                    Drop the file above. We parse it in the browser — nothing
                    hits the server until you click Write.
                  </span>
                </div>
                <div className="flex gap-2.5">
                  <span className="font-mono text-muted shrink-0 w-5">3.</span>
                  <span>
                    Each row matches by asset_id (col G), falling back to
                    description. Mismatches are listed so you can fix the sheet
                    and re-drop.
                  </span>
                </div>
                <div className="flex gap-2.5">
                  <span className="font-mono text-muted shrink-0 w-5">4.</span>
                  <span>
                    Captures upsert with source=
                    <span className="font-mono">file_reimport</span> and
                    source_file=<span className="font-mono">{'<filename>'}</span>
                    {' '}— the audit trail points back to the workbook.
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* ── Right column (sticky summary) ────────────────────────── */}
        <div className="flex flex-col gap-3.5 min-w-0">
          <Card padding={0} className="sticky top-4 self-start">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-[13px] font-bold text-ink">Summary</div>
            </div>
            <div className="p-4 flex flex-col gap-0.5">
              <MetaRow label="File" mono>
                {file ? (
                  <span className="break-all">{file.name}</span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </MetaRow>
              <MetaRow label="Sheet rows" mono>
                {summary.totalRowsInSheet || '—'}
              </MetaRow>
              <MetaRow label="Matched" mono>
                {result
                  ? `${summary.rowsMatched}/${summary.totalRowsInSheet}`
                  : '—'}
              </MetaRow>
              <MetaRow label="Captures" mono>
                {result ? summary.capturesDetected : '—'}
              </MetaRow>
              <MetaRow label="Source" mono>
                <span className="font-mono text-[11px]">file_reimport</span>
              </MetaRow>
              <MetaRow label="Captured by" mono>
                {capturerName ?? (
                  <span className="text-muted">Not set</span>
                )}
              </MetaRow>
            </div>

            {result && (
              <div className="px-4 pb-3">
                <div className="flex items-center justify-between mb-1.5 text-[11px] text-muted tabular-nums">
                  <span>Match rate</span>
                  <span className="font-mono">{matchPct}%</span>
                </div>
                <ProgressBar
                  done={summary.rowsMatched}
                  total={summary.totalRowsInSheet}
                  height={6}
                />
              </div>
            )}

            <div className="p-4 pt-0">
              <Button
                variant="primary"
                size="lg"
                icon={Upload}
                onClick={write}
                disabled={!canWrite || !job}
                className="w-full"
              >
                {writing
                  ? 'Writing…'
                  : writeSummary
                    ? 'Written'
                    : `Write ${summary.capturesDetected || ''} captures`.trim()}
              </Button>
              <div className="mt-2 text-[11px] text-muted text-center">
                {!file
                  ? 'Drop a filled template to preview'
                  : !result
                    ? parsing
                      ? 'Parsing…'
                      : 'Waiting'
                    : summary.capturesDetected === 0
                      ? 'No captured cells found in this file'
                      : writeSummary
                        ? `Wrote ${writeSummary.rowsWritten} captures ${new Date(writeSummary.at).toLocaleTimeString()}`
                        : 'Upsert — overwrites existing values for the same asset+field'}
              </div>
            </div>
          </Card>

          {writeSummary && (
            <Card className="bg-ok-bg border-ok">
              <div className="flex items-start gap-2">
                <CheckCircle2
                  size={16}
                  strokeWidth={2}
                  className="text-ok-fg shrink-0 mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ok-fg">
                    Captures written
                  </div>
                  <div className="text-[12px] text-ok-fg/80 mt-0.5 break-words">
                    {writeSummary.rowsWritten} rows upserted. Head to Progress
                    to verify.
                  </div>
                </div>
              </div>
            </Card>
          )}

          {writeError && (
            <Card className="bg-bad-bg border-bad">
              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={14}
                  strokeWidth={2}
                  className="text-bad-fg shrink-0 mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-bad-fg">
                    Write failed
                  </div>
                  <div className="text-[12px] text-bad-fg/80 mt-0.5 break-words">
                    {writeError}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {!job && (
            <Card padding={0}>
              <div className="p-4 flex items-start gap-2 text-[12px] text-muted">
                <FileSpreadsheet
                  size={14}
                  strokeWidth={2}
                  className="shrink-0 mt-[2px]"
                />
                <span>Loading job context…</span>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
