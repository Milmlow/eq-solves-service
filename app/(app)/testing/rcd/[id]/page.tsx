import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ChevronLeft } from 'lucide-react'

type Joined<T> = T | T[] | null

function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function statusToTone(status: string): 'active' | 'inactive' | 'in-progress' {
  if (status === 'complete') return 'active'
  if (status === 'archived') return 'inactive'
  return 'in-progress'
}

/**
 * RCD test detail — read-only view of one rcd_tests row + its circuits.
 *
 * Phase 1 scope: render header metadata + per-circuit table that mirrors
 * the Jemena 2025 xlsx layout (Date | Circuit # | Trip Current | X1
 * No-Trip 0/180 | X1 Trip 0/180 | X5 Fast 0/180 | Button | Asset ID
 * | Action Taken).
 *
 * Phase 2+ (separate PRs): inline edit, reading entry, status workflow,
 * report regeneration.
 */
export default async function RcdTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('rcd_tests')
    .select(
      '*, sites(name, code), assets(name, jemena_asset_id, manufacturer, model, location), customers(name)',
    )
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !test) notFound()

  const site = one(test.sites as Joined<{ name: string; code: string | null }>)
  const asset = one(test.assets as Joined<{
    name: string
    jemena_asset_id: string | null
    manufacturer: string | null
    model: string | null
    location: string | null
  }>)
  const customer = one(test.customers as Joined<{ name: string }>)

  const { data: circuits } = await supabase
    .from('rcd_test_circuits')
    .select('*')
    .eq('rcd_test_id', id)
    .order('sort_order')
    .order('section_label', { nullsFirst: true })
    .order('circuit_no')

  const sections = new Map<string, CircuitRow[]>()
  for (const c of (circuits ?? []) as CircuitRow[]) {
    const key = c.section_label ?? '__default__'
    const arr = sections.get(key) ?? []
    arr.push(c)
    sections.set(key, arr)
  }

  const statusTone = statusToTone(test.status)

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Testing', href: '/testing' },
            { label: 'RCD Testing', href: '/testing/rcd' },
            { label: asset?.name ?? 'Test' },
          ]}
        />
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-3xl font-bold text-eq-sky">
              {asset?.name ?? 'RCD Test'}
            </h1>
            <p className="text-sm text-eq-grey mt-1">
              {site?.name ?? '—'}
              {customer?.name && <span> · {customer.name}</span>}
              <span> · {test.test_date}</span>
            </p>
          </div>
          <Link
            href="/testing/rcd"
            className="text-sm text-eq-deep hover:text-eq-sky inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to list
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border border-gray-200 rounded-lg bg-white p-4">
        <Field label="Date" value={test.test_date} />
        <Field label="Site" value={site?.name ?? '—'} />
        <Field label="Board" value={asset?.name ?? '—'} />
        <Field label="Status" value={<StatusBadge status={statusTone} />} />
        <Field label="Jemena ID" value={asset?.jemena_asset_id ?? '—'} mono />
        <Field label="Technician" value={test.technician_name_snapshot ?? '—'} />
        <Field label="Initials" value={test.technician_initials ?? '—'} mono />
        <Field label="Site rep" value={test.site_rep_name ?? '—'} />
        {test.equipment_used && (
          <div className="col-span-2 md:col-span-4">
            <Field label="Equipment used" value={test.equipment_used} />
          </div>
        )}
        {test.notes && (
          <div className="col-span-2 md:col-span-4">
            <Field label="Notes" value={test.notes} />
          </div>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-eq-ice flex items-center justify-between">
          <h2 className="text-sm font-bold text-eq-deep uppercase tracking-wide">
            Circuits ({circuits?.length ?? 0})
          </h2>
          <span className="text-xs text-eq-grey">
            All times in ms · &gt;310 = no trip
          </span>
        </div>

        {!circuits || circuits.length === 0 ? (
          <div className="p-6 text-center text-sm text-eq-grey">
            No circuit data recorded for this test yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-eq-grey">
                <tr>
                  <Th>Circuit #</Th>
                  <Th>Trip mA</Th>
                  <Th colSpan={2} className="text-center border-l border-gray-200">
                    X1 No-Trip
                  </Th>
                  <Th colSpan={2} className="text-center border-l border-gray-200">
                    X1 Trip
                  </Th>
                  <Th colSpan={2} className="text-center border-l border-gray-200">
                    X5 Fast
                  </Th>
                  <Th className="text-center border-l border-gray-200">Btn</Th>
                  <Th className="border-l border-gray-200">Asset ID</Th>
                  <Th className="border-l border-gray-200">Action</Th>
                </tr>
                <tr className="text-[10px]">
                  <Th></Th>
                  <Th></Th>
                  <Th className="text-center border-l border-gray-200">0°</Th>
                  <Th className="text-center">180°</Th>
                  <Th className="text-center border-l border-gray-200">0°</Th>
                  <Th className="text-center">180°</Th>
                  <Th className="text-center border-l border-gray-200">0°</Th>
                  <Th className="text-center">180°</Th>
                  <Th className="text-center border-l border-gray-200"></Th>
                  <Th className="border-l border-gray-200"></Th>
                  <Th className="border-l border-gray-200"></Th>
                </tr>
              </thead>
              <tbody>
                {Array.from(sections.entries()).map(([key, rows]) => (
                  <SectionGroup
                    key={key}
                    label={key === '__default__' ? null : key}
                    rows={rows}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-eq-grey uppercase tracking-wide mb-0.5">
        {label}
      </div>
      <div className={`text-sm text-eq-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function Th({
  children,
  colSpan,
  className = '',
}: {
  children?: React.ReactNode
  colSpan?: number
  className?: string
}) {
  return (
    <th colSpan={colSpan} className={`px-2 py-1.5 font-semibold text-left ${className}`}>
      {children}
    </th>
  )
}

interface CircuitRow {
  id: string
  section_label: string | null
  circuit_no: string
  normal_trip_current_ma: number
  x1_no_trip_0_ms: string | null
  x1_no_trip_180_ms: string | null
  x1_trip_0_ms: string | null
  x1_trip_180_ms: string | null
  x5_fast_0_ms: string | null
  x5_fast_180_ms: string | null
  trip_test_button_ok: boolean
  jemena_circuit_asset_id: string | null
  action_taken: string | null
  is_critical_load: boolean
}

function SectionGroup({
  label,
  rows,
}: {
  label: string | null
  rows: CircuitRow[]
}) {
  return (
    <>
      {label && (
        <tr className="bg-eq-ice">
          <td
            colSpan={11}
            className="px-3 py-1.5 text-xs font-bold text-eq-deep uppercase tracking-wide"
          >
            {label}
          </td>
        </tr>
      )}
      {rows.map((c) => (
        <tr
          key={c.id}
          className={`border-t border-gray-100 ${c.is_critical_load ? 'bg-amber-50' : ''}`}
        >
          <td className="px-2 py-1.5 font-mono text-eq-ink">{c.circuit_no}</td>
          <td className="px-2 py-1.5">{c.normal_trip_current_ma}</td>
          <Td borderLeft>{c.x1_no_trip_0_ms}</Td>
          <Td>{c.x1_no_trip_180_ms}</Td>
          <Td borderLeft>{c.x1_trip_0_ms}</Td>
          <Td>{c.x1_trip_180_ms}</Td>
          <Td borderLeft>{c.x5_fast_0_ms}</Td>
          <Td>{c.x5_fast_180_ms}</Td>
          <td className="px-2 py-1.5 text-center border-l border-gray-100">
            {c.trip_test_button_ok ? '✓' : '—'}
          </td>
          <td className="px-2 py-1.5 font-mono text-eq-grey border-l border-gray-100">
            {c.jemena_circuit_asset_id ?? '—'}
          </td>
          <td className="px-2 py-1.5 border-l border-gray-100">
            {c.is_critical_load && (
              <span className="inline-block mr-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                CRITICAL
              </span>
            )}
            {c.action_taken ?? '—'}
          </td>
        </tr>
      ))}
    </>
  )
}

function Td({
  children,
  borderLeft = false,
}: {
  children: React.ReactNode
  borderLeft?: boolean
}) {
  return (
    <td
      className={`px-2 py-1.5 font-mono text-right ${borderLeft ? 'border-l border-gray-100' : ''}`}
    >
      {children ?? '—'}
    </td>
  )
}
