'use client'

/* ─── Types ─── */
export interface SiFunctionData {
  setting: string          // Ir / Isd / Ii value
  settingDelay: string     // tr / tsd (empty for Instantaneous — no delay)
  currentLevels: string    // test current in Amps
  currentCoefficient: string // test current as multiple of In
  tripTime: string         // measured trip time (s)
  minTripTime: string      // expected minimum
  maxTripTime: string      // expected maximum
  result: 'pass' | 'fail' | 'na'
}

export type SiReadingRow = {
  label: string
  value: string
  unit: string
  is_pass?: boolean
}

export function emptySiFunction(): SiFunctionData {
  return {
    setting: '',
    settingDelay: '',
    currentLevels: '',
    currentCoefficient: '',
    tripTime: '',
    minTripTime: '',
    maxTripTime: '',
    result: 'na',
  }
}

export function loadSiFunction(
  readings: { label: string; value: string; unit?: string | null; is_pass?: boolean | null }[],
  prefix: string,
  hasDelay: boolean,
): SiFunctionData {
  const get = (key: string) =>
    readings.find(r => r.label === `${prefix}${key}`)?.value ?? ''

  const resultRow = readings.find(r => r.label === `${prefix}Result`)
  let result: 'pass' | 'fail' | 'na' = 'na'
  if (resultRow) {
    if (resultRow.is_pass === true) result = 'pass'
    else if (resultRow.is_pass === false) result = 'fail'
    else result = 'na'
  }

  return {
    setting: get('Setting'),
    settingDelay: hasDelay ? get('Delay') : '',
    currentLevels: get('Current Levels (A)'),
    currentCoefficient: get('Current Coefficient'),
    tripTime: get('Trip Time (s)'),
    minTripTime: get('Min Trip Time'),
    maxTripTime: get('Max Trip Time'),
    result,
  }
}

export function siToReadings(
  data: SiFunctionData,
  prefix: string,
  hasDelay: boolean,
): SiReadingRow[] {
  const rows: SiReadingRow[] = []

  if (data.setting)          rows.push({ label: `${prefix}Setting`,              value: data.setting,           unit: '' })
  if (hasDelay && data.settingDelay)
                             rows.push({ label: `${prefix}Delay`,                value: data.settingDelay,      unit: '' })
  if (data.currentLevels)   rows.push({ label: `${prefix}Current Levels (A)`,   value: data.currentLevels,    unit: 'A' })
  if (data.currentCoefficient) rows.push({ label: `${prefix}Current Coefficient`, value: data.currentCoefficient, unit: '×In' })
  if (data.tripTime)         rows.push({ label: `${prefix}Trip Time (s)`,        value: data.tripTime,          unit: 's' })
  if (data.minTripTime)      rows.push({ label: `${prefix}Min Trip Time`,         value: data.minTripTime,       unit: 's' })
  if (data.maxTripTime)      rows.push({ label: `${prefix}Max Trip Time`,         value: data.maxTripTime,       unit: 's' })

  // Result is always included
  rows.push({
    label: `${prefix}Result`,
    value: data.result === 'pass' ? 'PASS' : data.result === 'fail' ? 'FAIL' : 'N/A',
    unit: '',
    is_pass: data.result === 'pass' ? true : data.result === 'fail' ? false : undefined,
  })

  return rows
}

/* ─── TriStateButton (inline copy — same as workflow files) ─── */
function TriStateButton({ value, onChange }: {
  value: 'pass' | 'fail' | 'na'
  onChange: (v: 'pass' | 'fail' | 'na') => void
}) {
  return (
    <div className="flex gap-1">
      {(['pass', 'fail', 'na'] as const).map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`min-h-[44px] px-3 py-2 text-sm rounded font-medium select-none touch-manipulation active:scale-95 ${
            value === opt
              ? opt === 'pass'
                ? 'bg-green-600 text-white'
                : opt === 'fail'
                ? 'bg-red-600 text-white'
                : 'bg-gray-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {opt === 'pass' ? 'OK' : opt === 'fail' ? 'Not OK' : 'N/A'}
        </button>
      ))}
    </div>
  )
}

/* ─── Input styling ─── */
const inputCls = 'w-full h-9 px-3 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20'

/* ─── SingleFunctionCard ─── */
interface SingleFunctionCardProps {
  title: string
  settingLabel: string        // 'Ir' | 'Isd' | 'Ii'
  delayLabel: string | null   // 'tr' | 'tsd' | null (Instantaneous)
  data: SiFunctionData
  onChange: (data: SiFunctionData) => void
}

function SingleFunctionCard({ title, settingLabel, delayLabel, data, onChange }: SingleFunctionCardProps) {
  const set = (field: keyof SiFunctionData, value: string | 'pass' | 'fail' | 'na') =>
    onChange({ ...data, [field]: value })

  const resultBg =
    data.result === 'pass' ? 'bg-green-50' :
    data.result === 'fail' ? 'bg-red-50' :
    'bg-gray-50'

  const rows: Array<{ label: string; field: keyof SiFunctionData; show: boolean }> = [
    { label: settingLabel,       field: 'setting',           show: true },
    { label: delayLabel ?? '',   field: 'settingDelay',      show: delayLabel !== null },
    { label: 'Current Levels (A)', field: 'currentLevels',  show: true },
    { label: 'Current Coeff (×In)', field: 'currentCoefficient', show: true },
    { label: 'Trip Time (s)',    field: 'tripTime',          show: true },
    { label: 'Min Trip Time',    field: 'minTripTime',       show: true },
    { label: 'Max Trip Time',    field: 'maxTripTime',       show: true },
  ]

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-eq-ink">{title}</h4>
      </div>

      {/* Fields */}
      <div className="p-4 space-y-3">
        {rows.filter(r => r.show).map(r => (
          <div key={r.field}>
            <label className="block text-xs font-medium text-eq-grey mb-1">{r.label}</label>
            <input
              type="text"
              value={data[r.field] as string}
              onChange={e => set(r.field, e.target.value)}
              className={inputCls}
            />
          </div>
        ))}

        {/* Result */}
        <div className={`rounded-md p-3 ${resultBg}`}>
          <label className="block text-xs font-medium text-eq-grey mb-2">Pass / Fail / NA</label>
          <TriStateButton
            value={data.result}
            onChange={v => set('result', v)}
          />
        </div>
      </div>
    </div>
  )
}

/* ─── SecondaryInjectionTable ─── */
export interface SecondaryInjectionTableProps {
  longTime: SiFunctionData
  shortTime: SiFunctionData
  instantaneous: SiFunctionData
  onChange: (fn: 'longTime' | 'shortTime' | 'instantaneous', data: SiFunctionData) => void
}

export function SecondaryInjectionTable({
  longTime,
  shortTime,
  instantaneous,
  onChange,
}: SecondaryInjectionTableProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <SingleFunctionCard
        title="Long Time"
        settingLabel="Ir"
        delayLabel="tr"
        data={longTime}
        onChange={data => onChange('longTime', data)}
      />
      <SingleFunctionCard
        title="Short Time"
        settingLabel="Isd"
        delayLabel="tsd"
        data={shortTime}
        onChange={data => onChange('shortTime', data)}
      />
      <SingleFunctionCard
        title="Instantaneous"
        settingLabel="Ii"
        delayLabel={null}
        data={instantaneous}
        onChange={data => onChange('instantaneous', data)}
      />
    </div>
  )
}
