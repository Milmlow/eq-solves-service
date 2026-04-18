import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { TopBar } from '../components/TopBar'
import { allCaptures, pendingCount, subscribeQueue, syncPending } from '../lib/queue'
import { supabase } from '../lib/supabase'
import { downloadCompletedWorkbook, downloadCsv } from '../lib/export'

export function ExportPage({ jobRef }: { jobRef: string }) {
  const { job } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(pendingCount())
  const [templateFile, setTemplateFile] = useState<File | null>(null)

  useEffect(() => subscribeQueue(() => setPending(pendingCount())), [])

  const requiredFieldIds = useMemo(
    () => new Set(fields.filter((f) => f.is_field_captured).map((f) => f.id)),
    [fields],
  )

  const captures = allCaptures()
  const filled = useMemo(() => {
    let n = 0
    for (const c of captures) {
      if (!c.value) continue
      if (!requiredFieldIds.has(c.classificationFieldId)) continue
      n++
    }
    return n
  }, [captures, requiredFieldIds])
  const totalCells = assets.length * requiredFieldIds.size

  const exportXlsx = async () => {
    if (!templateFile) {
      setError('Please upload the original Equinix template workbook first.')
      return
    }
    setError(null)
    setBuilding(true)
    try {
      // Sync first if there's anything pending
      if (pendingCount() > 0) await syncPending()

      // Pull the most up-to-date captures from Supabase
      const { data: serverCaptures, error: sErr } = await supabase
        .from('captures')
        .select('asset_id, classification_field_id, value')
        .in(
          'asset_id',
          assets.map((a) => a.id),
        )
      if (sErr) throw sErr

      await downloadCompletedWorkbook({
        templateFile,
        job: job!,
        assets,
        fields,
        captures: (serverCaptures ?? []) as Array<{
          asset_id: string
          classification_field_id: number
          value: string | null
        }>,
      })
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBuilding(false)
    }
  }

  const exportCsvFile = async () => {
    setError(null)
    setBuilding(true)
    try {
      if (pendingCount() > 0) await syncPending()
      const { data: serverCaptures, error: sErr } = await supabase
        .from('captures')
        .select('asset_id, classification_field_id, value, captured_by, captured_at, notes, flagged')
        .in(
          'asset_id',
          assets.map((a) => a.id),
        )
      if (sErr) throw sErr
      downloadCsv({
        job: job!,
        assets,
        fields,
        captures: (serverCaptures ?? []) as any[],
      })
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        title="Export"
        subtitle={job ? `${job.site_code} · ${job.classification_code}` : ''}
        onBack={() => navigate(`/j/${jobRef}`)}
      />

      <div className="flex-1 px-4 pt-4 pb-6 space-y-4 safe-bottom">
        <div className="card p-4">
          <h2 className="font-bold text-ink mb-1">Progress</h2>
          <p className="text-sm text-muted mb-3">
            {filled} of {totalCells} data points captured across {assets.length} assets.
          </p>
          <div className="h-2 rounded-full bg-border/60 overflow-hidden">
            <div
              className="h-full bg-sky transition-all"
              style={{ width: `${totalCells ? (filled / totalCells) * 100 : 0}%` }}
            />
          </div>
          {pending > 0 ? (
            <div className="mt-3 text-xs text-warn font-semibold">
              {pending} captures pending sync — will auto-sync before export.
            </div>
          ) : null}
        </div>

        <div className="card p-4">
          <h2 className="font-bold text-ink mb-1">Option 1 — Completed workbook</h2>
          <p className="text-sm text-muted mb-3">
            Upload the original Equinix template and we'll fill the green cells with the captured
            data and give it straight back. The rest of the workbook is untouched.
          </p>
          <input
            type="file"
            accept=".xlsm,.xlsx"
            onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm mb-3"
          />
          <button
            disabled={building || !templateFile}
            onClick={exportXlsx}
            className="btn btn-primary btn-lg w-full disabled:opacity-40"
          >
            {building ? 'Generating…' : 'Generate completed workbook'}
          </button>
        </div>

        <div className="card p-4">
          <h2 className="font-bold text-ink mb-1">Option 2 — Flat CSV</h2>
          <p className="text-sm text-muted mb-3">
            Every capture as one row (asset, field, value, captured_by, timestamp, notes). Good for
            auditing or pasting into your own workbook.
          </p>
          <button
            disabled={building}
            onClick={exportCsvFile}
            className="btn btn-ghost btn-lg w-full"
          >
            {building ? 'Generating…' : 'Download CSV'}
          </button>
        </div>

        {error ? <div className="card p-4 border-bad/40 bg-bad/5 text-sm text-bad">{error}</div> : null}
      </div>
    </div>
  )
}
