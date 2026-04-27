'use client'

import { useMemo, useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import {
  previewCommercialSheetAction,
  previewExistingCountsAction,
  commitImportAction,
  type CustomerOption,
  type SiteOption,
  type PreviewResult,
  type ExistingCounts,
} from './actions'

// Local copy of the parsed-scope shape to avoid importing the parser into a
// client module (it brings exceljs in via re-exports).
interface PreviewScope {
  jp_code: string | null
  scope_item: string
  asset_qty: number
  intervals_text: string
  cycle_costs: Record<string, number>
  year_totals: Record<string, number>
  due_years: Record<string, number>
  unit_rate_per_asset: number | null
  source_sheet: string
}

type Phase = 'idle' | 'parsing' | 'previewing' | 'committing' | 'done'

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 })
}

export function CommercialSheetImporter() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [counts, setCounts] = useState<ExistingCounts | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [year, setYear] = useState('2026')
  const [wipeFirst, setWipeFirst] = useState(true)
  const [confirmName, setConfirmName] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const sitesForCustomer: SiteOption[] = useMemo(() => {
    if (!preview || !customerId) return []
    return preview.sites.filter((s) => s.customer_id === customerId)
  }, [preview, customerId])

  const selectedCustomer: CustomerOption | undefined = useMemo(
    () => preview?.customers.find((c) => c.id === customerId),
    [preview, customerId],
  )

  const allScopes: PreviewScope[] = useMemo(() => {
    if (!preview) return []
    return [...preview.parsed.scopes, ...preview.parsed.additional_items]
  }, [preview])

  const yearTotal = useMemo(() => {
    return allScopes.reduce((sum, s) => sum + (s.year_totals[year] ?? 0), 0)
  }, [allScopes, year])

  const confirmMatch =
    !!selectedCustomer && confirmName.trim() === (selectedCustomer.name ?? '').trim()
  const canCommit =
    !!file && !!customerId && !!siteId && /^\d{4}$/.test(year) && confirmMatch && !pending

  function resetAll() {
    setPhase('idle')
    setFile(null)
    setPreview(null)
    setCounts(null)
    setCustomerId('')
    setSiteId('')
    setYear('2026')
    setWipeFirst(true)
    setConfirmName('')
    setBanner(null)
  }

  function handleFile(f: File) {
    setFile(f)
    setPreview(null)
    setCustomerId('')
    setSiteId('')
    setConfirmName('')
    setCounts(null)
    setBanner(null)
    setPhase('parsing')
    const fd = new FormData()
    fd.set('file', f)
    startTransition(async () => {
      const res = await previewCommercialSheetAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        setPhase('idle')
        return
      }
      setPreview(res)
      setPhase('previewing')
      // Pre-select customer + site if site_hint resolved.
      if (res.matchedSiteId) {
        const matchedSite = res.sites.find((s) => s.id === res.matchedSiteId)
        if (matchedSite) {
          setCustomerId(matchedSite.customer_id)
          setSiteId(matchedSite.id)
        }
      }
    })
  }

  // Whenever customer or year changes, refresh the existing-data counts.
  function refreshCounts(custId: string, yr: string) {
    if (!custId || !/^\d{4}$/.test(yr)) {
      setCounts(null)
      return
    }
    const fd = new FormData()
    fd.set('customer_id', custId)
    fd.set('financial_year', yr)
    startTransition(async () => {
      const res = await previewExistingCountsAction(fd)
      if (res.ok) setCounts(res.counts)
      else setCounts(null)
    })
  }

  function handleCustomerChange(id: string) {
    setCustomerId(id)
    setSiteId('')
    setConfirmName('')
    refreshCounts(id, year)
  }

  function handleYearChange(y: string) {
    setYear(y)
    refreshCounts(customerId, y)
  }

  function handleCommit() {
    if (!file || !customerId || !siteId || !selectedCustomer) return
    setBanner(null)
    setPhase('committing')
    const fd = new FormData()
    fd.set('file', file)
    fd.set('customer_id', customerId)
    fd.set('site_id', siteId)
    fd.set('financial_year', year)
    fd.set('confirm_name', confirmName)
    fd.set('wipe_first', wipeFirst ? 'true' : 'false')
    startTransition(async () => {
      const res = await commitImportAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        setPhase('previewing')
        return
      }
      setBanner({
        kind: 'ok',
        msg:
          `Imported ${res.inserted.scopes} JP rows + ${res.inserted.additional_items} additional ` +
          `into ${selectedCustomer.name} (${year}). ` +
          (wipeFirst
            ? `Wiped first: ${res.wiped.scopes} scopes, ${res.wiped.calendar} calendar, ${res.wiped.gaps} gaps.`
            : 'No wipe.'),
      })
      setPhase('done')
    })
  }

  return (
    <div className="space-y-4">
      {banner && (
        <div className={
          'px-4 py-2 rounded-md border text-sm ' +
          (banner.kind === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800')
        }>
          {banner.msg}
        </div>
      )}

      {/* File picker */}
      <Card>
        <h2 className="text-base font-semibold text-eq-ink">1. Upload commercial-sheet workbook</h2>
        <p className="text-xs text-eq-grey mt-1">
          One xlsx per site. Filename should follow the DELTA ELCOM pattern so the site
          can be auto-detected.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
            className="text-sm text-eq-ink"
          />
          {file && (
            <Button variant="secondary" size="sm" onClick={resetAll} disabled={pending}>
              Reset
            </Button>
          )}
        </div>
        {phase === 'parsing' && <p className="text-xs text-eq-grey mt-3">Parsing workbook…</p>}
        {preview && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">File</p>
              <p className="text-eq-ink truncate" title={preview.filename}>{preview.filename}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Site hint</p>
              <p className="text-eq-ink">{preview.parsed.site_hint ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Priced JPs</p>
              <p className="text-eq-ink">{preview.parsed.scopes.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Additional items</p>
              <p className="text-eq-ink">{preview.parsed.additional_items.length}</p>
            </div>
          </div>
        )}
        {preview && preview.parsed.warnings.length > 0 && (
          <ul className="mt-3 text-xs text-amber-700 space-y-1">
            {preview.parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
      </Card>

      {/* Customer + site + year picker */}
      {preview && (
        <Card>
          <h2 className="text-base font-semibold text-eq-ink">2. Target customer + site + year</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</label>
              <select
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                disabled={pending}
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              >
                <option value="">— Pick customer —</option>
                {preview.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.code ? ` (${c.code})` : ''}{c.contract_template ? ` · ${c.contract_template}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={pending || !customerId}
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 disabled:bg-gray-50 disabled:text-eq-grey"
              >
                <option value="">— Pick site —</option>
                {sitesForCustomer.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.code} — ${s.name}` : s.name}
                  </option>
                ))}
              </select>
              {preview.matchedSiteId && siteId === preview.matchedSiteId && (
                <p className="text-xs text-green-600">Auto-matched from filename hint.</p>
              )}
            </div>
            <FormInput
              label="Financial Year"
              value={year}
              onChange={(e) => handleYearChange(e.target.value)}
              disabled={pending}
              placeholder="2026"
              maxLength={4}
              inputMode="numeric"
            />
          </div>
          {customerId && counts && (counts.scopes + counts.calendar + counts.gaps) > 0 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
              <p className="font-semibold">Existing data for this customer in {year}:</p>
              <p className="mt-1">
                {counts.scopes} contract scope row{counts.scopes === 1 ? '' : 's'}, {' '}
                {counts.calendar} calendar entr{counts.calendar === 1 ? 'y' : 'ies'}, {' '}
                {counts.gaps} coverage gap{counts.gaps === 1 ? '' : 's'}.
              </p>
              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wipeFirst}
                  onChange={(e) => setWipeFirst(e.target.checked)}
                  disabled={pending}
                />
                <span>
                  Wipe these before inserting. <span className="text-amber-700">(Recommended for re-import.)</span>
                </span>
              </label>
            </div>
          )}
        </Card>
      )}

      {/* Preview table */}
      {preview && allScopes.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-eq-ink">3. Preview parsed rows</h2>
            <p className="text-sm font-semibold text-eq-deep">
              {year} total: {fmtCurrency(yearTotal)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-eq-grey uppercase tracking-wide">
                <tr>
                  <th className="text-left px-2 py-2 font-bold">JP</th>
                  <th className="text-left px-2 py-2 font-bold">Scope</th>
                  <th className="text-right px-2 py-2 font-bold">Qty</th>
                  <th className="text-left px-2 py-2 font-bold">Intervals</th>
                  <th className="text-left px-2 py-2 font-bold">Cycle costs</th>
                  <th className="text-right px-2 py-2 font-bold">{year}</th>
                  <th className="text-left px-2 py-2 font-bold">Due years</th>
                  <th className="text-left px-2 py-2 font-bold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allScopes.map((s, i) => {
                  const cycleStr = Object.entries(s.cycle_costs)
                    .map(([k, v]) => `${k}: ${fmtCurrency(v)}`)
                    .join(', ')
                  const dueStr = Object.entries(s.due_years)
                    .map(([y, c]) => `${y}: ${c}`)
                    .join(', ')
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1.5 text-eq-deep font-mono">{s.jp_code ?? '—'}</td>
                      <td className="px-2 py-1.5 text-eq-ink">{s.scope_item}</td>
                      <td className="px-2 py-1.5 text-right text-eq-ink">{s.asset_qty || (s.unit_rate_per_asset !== null ? '—' : '0')}</td>
                      <td className="px-2 py-1.5 text-eq-grey">{s.intervals_text || '—'}</td>
                      <td className="px-2 py-1.5 text-eq-grey">
                        {cycleStr || (s.unit_rate_per_asset !== null ? `unit: ${fmtCurrency(s.unit_rate_per_asset)}` : '—')}
                      </td>
                      <td className="px-2 py-1.5 text-right text-eq-ink">{fmtCurrency(s.year_totals[year] ?? 0)}</td>
                      <td className="px-2 py-1.5 text-eq-grey">{dueStr || '—'}</td>
                      <td className="px-2 py-1.5 text-eq-grey">{s.source_sheet}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Confirm + commit */}
      {preview && customerId && siteId && (
        <Card className="border-red-200">
          <h2 className="text-base font-semibold text-eq-ink">4. Confirm + commit</h2>
          <p className="text-xs text-eq-grey mt-1">
            Type <span className="font-mono font-semibold text-eq-ink">{selectedCustomer?.name}</span>{' '}
            to enable the commit button.
          </p>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder="Type the customer name exactly"
            disabled={pending}
            className="mt-2 w-full h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={resetAll} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCommit}
              disabled={!canCommit}
              className="!bg-red-600 hover:!bg-red-700 !text-white disabled:!bg-gray-300"
            >
              {pending && phase === 'committing'
                ? 'Importing…'
                : wipeFirst
                  ? `Wipe ${year} & import`
                  : `Import ${year}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
