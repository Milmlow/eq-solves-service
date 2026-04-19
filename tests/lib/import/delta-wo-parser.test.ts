import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseWorkbook,
  stripSitePrefix,
  splitJobPlanCode,
  mapFrequencySuffix,
  FREQUENCY_SUFFIX_MAP,
} from '@/lib/import/delta-wo-parser'

const FIXTURE = join(__dirname, 'fixtures', 'WO_Aug_2025_Delta.xlsx')

describe('stripSitePrefix', () => {
  it('strips AU01- prefix', () => {
    expect(stripSitePrefix('AU01-SY3')).toBe('SY3')
  })

  it('strips AU02- prefix (generalises)', () => {
    expect(stripSitePrefix('AU02-ME1')).toBe('ME1')
  })

  it('leaves unprefixed codes alone', () => {
    expect(stripSitePrefix('SY3')).toBe('SY3')
  })

  it('trims whitespace', () => {
    expect(stripSitePrefix('  AU01-SY3  ')).toBe('SY3')
  })

  it('handles empty input', () => {
    expect(stripSitePrefix('')).toBe('')
  })
})

describe('splitJobPlanCode', () => {
  it('splits on the last dash', () => {
    expect(splitJobPlanCode('LVACB-A')).toEqual({ code: 'LVACB', suffix: 'A' })
  })

  it('handles numeric suffixes', () => {
    expect(splitJobPlanCode('ATS-3')).toEqual({ code: 'ATS', suffix: '3' })
  })

  it('keeps multi-part codes intact, only splitting the final suffix', () => {
    expect(splitJobPlanCode('LTNLTNG-AGPRO-A')).toEqual({
      code: 'LTNLTNG-AGPRO',
      suffix: 'A',
    })
  })

  it('returns empty suffix for codes without a dash', () => {
    expect(splitJobPlanCode('UHD')).toEqual({ code: 'UHD', suffix: '' })
  })
})

describe('mapFrequencySuffix', () => {
  it('A → annual', () => {
    expect(mapFrequencySuffix('A')).toBe('annual')
  })

  it('3 → quarterly (3-monthly is quarterly)', () => {
    expect(mapFrequencySuffix('3')).toBe('quarterly')
  })

  it('Q → quarterly', () => {
    expect(mapFrequencySuffix('Q')).toBe('quarterly')
  })

  it('M → monthly', () => {
    expect(mapFrequencySuffix('M')).toBe('monthly')
  })

  it('is case-insensitive', () => {
    expect(mapFrequencySuffix('a')).toBe('annual')
  })

  it('returns null for unknown suffixes (fail-closed per spec)', () => {
    expect(mapFrequencySuffix('XYZ')).toBeNull()
    expect(mapFrequencySuffix('')).toBeNull()
  })

  it('maps all documented suffixes', () => {
    // Smoke — guard against accidental deletions from the map
    expect(Object.keys(FREQUENCY_SUFFIX_MAP)).toEqual(
      expect.arrayContaining(['A', 'Q', 'M', 'S', 'W', '2', '3', '5', '6', '10']),
    )
  })
})

describe('parseWorkbook — WO Aug 2025_Delta.xlsx fixture', () => {
  it('parses exactly 250 rows with zero errors', async () => {
    const buf = readFileSync(FIXTURE)
    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(250)
  })

  it('groups rows into 16 maintenance checks', async () => {
    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    expect(groups).toHaveLength(16)
  })

  it('all rows resolve to SY3 after prefix strip', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const uniqueSites = new Set(rows.map((r) => r.siteCode))
    expect(uniqueSites).toEqual(new Set(['SY3']))

    // And the raw still has the AU01 prefix
    expect(rows[0].site).toBe('AU01-SY3')
  })

  it('largest group is LVACB annual on 2025-08-20 with 112 assets', async () => {
    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    const biggest = groups[0] // sort puts biggest first
    expect(biggest.jobPlanCode).toBe('LVACB')
    expect(biggest.frequency).toBe('annual')
    expect(biggest.startDate.toISOString().slice(0, 10)).toBe('2025-08-20')
    expect(biggest.rows).toHaveLength(112)
  })

  it('PDU group has 76 assets on 2025-08-02 (annual transformer round)', async () => {
    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    const pdu = groups.find(
      (g) => g.jobPlanCode === 'PDU' && g.frequency === 'annual',
    )
    expect(pdu).toBeDefined()
    expect(pdu!.rows).toHaveLength(76)
    expect(pdu!.startDate.toISOString().slice(0, 10)).toBe('2025-08-02')
  })

  it('ATS uses quarterly suffix "3"', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const atsRows = rows.filter((r) => r.jobPlanCode === 'ATS')
    expect(atsRows.length).toBeGreaterThan(0)
    for (const r of atsRows) {
      expect(r.frequencySuffix).toBe('3')
      expect(r.frequency).toBe('quarterly')
    }
  })

  it('MVSWBD rows parse (importer will later fuzzy-match to MVSWDB)', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const mv = rows.filter((r) => r.jobPlanCode === 'MVSWBD')
    expect(mv.length).toBeGreaterThanOrEqual(1)
    // Parser stays dumb — it emits the code as-is. Fuzzy matching happens
    // in the preview server action against the tenant's job_plans list.
    expect(mv[0].frequency).toBe('annual')
  })

  it('every row has a work order number and a maximo asset id', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    for (const r of rows) {
      // Work orders in Maximo are numeric strings (e.g. "3962180")
      expect(r.workOrder).toMatch(/^\d+$/)
      // Asset IDs are mostly numeric but may have an alphabetic suffix
      // (e.g. "1746A") — the parser emits the raw Maximo string unchanged.
      expect(r.maximoAssetId).toMatch(/^\d+[A-Za-z]?$/)
    }
  })

  it('expected job plan code coverage (12 distinct codes)', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const codes = new Set(rows.map((r) => r.jobPlanCode))
    expect(codes).toEqual(
      new Set([
        'LVACB',
        'PDU',
        'SWBD',
        'LTSWBD',
        'ATS',
        'MVSWBD',
        'EVCS',
        'LBS',
        'LIGHTN',
        'LCP',
        'LB',
        'LIGHTING',
      ]),
    )
  })

  it('group counts match the locked spec', async () => {
    // From project_delta_wo_import.md — the 16 groups and their sizes.
    const expected = [
      { code: 'LVACB', freq: 'annual', date: '2025-08-20', n: 112 },
      { code: 'PDU', freq: 'annual', date: '2025-08-02', n: 76 },
      { code: 'LVACB', freq: 'annual', date: '2025-08-08', n: 17 },
      { code: 'SWBD', freq: 'annual', date: '2025-08-07', n: 14 },
      { code: 'LTSWBD', freq: 'annual', date: '2025-08-07', n: 14 },
      { code: 'SWBD', freq: 'annual', date: '2025-08-20', n: 3 },
      { code: 'ATS', freq: 'quarterly', date: '2025-08-05', n: 2 },
      { code: 'ATS', freq: 'quarterly', date: '2025-08-07', n: 2 },
      { code: 'EVCS', freq: 'annual', date: '2025-08-20', n: 2 },
      { code: 'LBS', freq: 'annual', date: '2025-08-26', n: 2 },
      { code: 'LIGHTN', freq: 'annual', date: '2025-08-07', n: 1 },
      { code: 'LCP', freq: 'quarterly', date: '2025-08-07', n: 1 },
      { code: 'SWBD', freq: 'annual', date: '2025-08-08', n: 1 },
      { code: 'LB', freq: 'annual', date: '2025-08-20', n: 1 },
      { code: 'LIGHTING', freq: 'monthly', date: '2025-08-20', n: 1 },
      { code: 'MVSWBD', freq: 'annual', date: '2025-08-26', n: 1 },
    ]

    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    for (const exp of expected) {
      const match = groups.find(
        (g) =>
          g.jobPlanCode === exp.code &&
          g.frequency === exp.freq &&
          g.startDate.toISOString().slice(0, 10) === exp.date,
      )
      expect(match, `Missing group ${exp.code}/${exp.freq}/${exp.date}`).toBeDefined()
      expect(match!.rows).toHaveLength(exp.n)
    }
  })

  it('totals — 250 rows across 16 groups, no orphans', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows, groups } = await parseWorkbook(buf)

    const totalInGroups = groups.reduce((sum, g) => sum + g.rows.length, 0)
    expect(totalInGroups).toBe(rows.length)
    expect(totalInGroups).toBe(250)
  })
})
