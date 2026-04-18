/**
 * ACB Test Report — DOCX Generator
 *
 * Produces a per-site report matching the Delta Elcom template:
 *   Cover → TOC → per-breaker sections (CB details, visual/functional,
 *   electrical testing, protection results).
 *
 * Works with existing acb_tests + acb_test_readings schema.
 * Readings are categorised by label prefix into template sections.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  PageNumber,
  PageBreak,
  TableOfContents,
  Bookmark,
  VerticalAlign,
  ImageRun,
} from 'docx'

// ---------- types ----------

export interface AcbReportInput {
  siteName: string
  siteCode: string | null
  tenantProductName: string
  primaryColour: string // hex without #
  complexity?: 'summary' | 'standard' | 'detailed'
  tests: AcbReportTest[]

  // Report settings (optional — all generators now read these)
  /** @deprecated Pass `logoImageOnLight` / `logoImageOnDark` instead. */
  logoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  companyName?: string
  companyAddress?: string
  companyAbn?: string
  companyPhone?: string
  showCoverPage?: boolean
  showContents?: boolean
  showExecutiveSummary?: boolean
  showSignOff?: boolean
  customHeaderText?: string
  customFooterText?: string
  signOffFields?: string[]
}

export interface AcbReportTest {
  assetName: string
  assetType: string
  location: string | null
  assetId: string | null // maximo / reference
  jobPlan: string | null
  testDate: string
  testedBy: string | null
  testType: string
  cbMake: string | null
  cbModel: string | null
  cbSerial: string | null
  overallResult: string
  notes: string | null
  readings: AcbReportReading[]
}

export interface AcbReportReading {
  label: string
  value: string
  unit: string | null
  isPass: boolean | null
  sortOrder: number
}

// ---------- constants ----------

const PAGE_WIDTH = 11906 // A4 DXA
const PAGE_HEIGHT = 16838
const MARGIN = 1440 // 1 inch
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2 // 9026

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 }

// CB details attribute rows (left column, right column)
const CB_ATTR_ROWS: [string, string][] = [
  ['Brand', 'Short-Time Tripping Delay - tsd'],
  ['Breaker Type', 'Instantaneous Pickup - li'],
  ['Serial No', 'Instantaneous Pickup - lsd'],
  ['Performance Level', 'Earth-Fault Pickup - lg'],
  ['Protection Unit Fitted', 'Earth-Fault Pickup - tg'],
  ['Trip Unit Model', 'Earth-Fault Pickup - I\u0394n'],
  ['Number of Poles', 'Earth-Leakage Tripping Delay - \u0394t'],
  ['Current Rating', 'Motor Charge'],
  ['Fixed / Withdrawable', 'Shunt Trip (MX1)'],
  ['Long Time - lr', 'Shunt Close (XF)'],
  ['Long Time Delay - tr', 'Undervoltage (MN)'],
  ['Short-Time Pickup - lsd', 'Second Shunt Trip'],
]

// Visual/functional quick items (before main checklist)
const VF_QUICK_ITEMS = [
  'Operation Counter - Before',
  'Castle Key Fitted',
  'Functioning of the safety shutters (De-energised ONLY)',
]

// Visual/functional checklist items with section and default order
const VF_CHECKLIST: { name: string; order: number; section: string }[] = [
  { name: 'General Condition', order: 10, section: 'Visual Inspection' },
  { name: 'Condition of connection pads (flags)', order: 20, section: 'Visual Inspection' },
  { name: 'Main contact wear', order: 30, section: 'Visual Inspection' },
  { name: 'Condition of the ARC chute', order: 40, section: 'Visual Inspection' },
  { name: 'Connection pads degreasing', order: 50, section: 'Mechanical / Active parts degreasing' },
  { name: 'Castel key operational', order: 60, section: 'Device Functional Check' },
  { name: 'Functioning of the operational counter', order: 70, section: 'Device Functional Check' },
  { name: 'Functioning of OF Status contacts', order: 80, section: 'Device Functional Check' },
  { name: 'Functioning of the XF (Close coil) at minimum voltage', order: 90, section: 'Device Functional Check' },
  { name: 'Complete closing of device', order: 100, section: 'Device Functional Check' },
  { name: 'Functioning of the MX (Shunt trip) at minimum voltage', order: 110, section: 'Device Functional Check' },
  { name: 'Functioning of the MX2 (Shunt trip) at minimum voltage', order: 115, section: 'Device Functional Check' },
  { name: 'Functioning of the pre-tripping system', order: 120, section: 'Device Functional Check' },
  { name: 'Functioning of the MN Undervoltage coil at minimum voltage', order: 130, section: 'Device Functional Check' },
  { name: 'Functioning of the MCH motor charge at minimum voltage', order: 140, section: 'Device Functional Check' },
  { name: 'Manual charge test', order: 150, section: 'Device Functional Check' },
  { name: 'Manual closing test', order: 160, section: 'Device Functional Check' },
  { name: 'Manual opening test', order: 170, section: 'Device Functional Check' },
  { name: 'Pull test on auxiliary wiring', order: 180, section: 'Auxiliaries Check' },
  { name: 'Apply service sticker with date of service', order: 190, section: 'Device Racking In' },
  { name: 'Connection pads greasing', order: 200, section: 'Mechanical / Active parts greasing' },
  { name: 'Connecting clusters and cluster supports greasing', order: 210, section: 'Mechanical / Active parts greasing' },
  { name: 'Position locking / racking into position', order: 220, section: 'Device Racking In' },
  { name: 'Observation of racking mechanism into cradle', order: 230, section: 'Device Racking In' },
  { name: 'Change battery of protection unit', order: 240, section: 'Device Functional Check' },
  { name: 'Replace battery', order: 250, section: 'Device Functional Check' },
  { name: 'Additional information / items to be actioned', order: 260, section: 'Overall' },
]

// Electrical testing labels
const ET_CONTACT_PHASES = ['Red Phase', 'Blue Phase', 'White Phase']
const ET_IR_CLOSED = [
  'Red > White', 'Red > Earth', 'Blue > Neutral',
  'Red > Blue', 'White > Earth', 'Red > Neutral',
  'White > Blue', 'Blue > Earth', 'White > Neutral',
]
const ET_IR_OPEN = ['Red > Red', 'White > White', 'Blue > Blue', 'Neutral > Neutral']

// Protection test rows
const PROTECTION_ROWS = ['Short time', 'Instantaneous', 'Long time']

// ---------- helpers ----------

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: 'D5E8F0', type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: 'Plus Jakarta Sans' })] })],
  })
}

function cell(text: string, width: number, opts?: { bold?: boolean; shading?: string }): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text: text || '', bold: opts?.bold, size: 18, font: 'Plus Jakarta Sans' })] })],
  })
}

function passFailText(val: boolean | null): string {
  if (val === true) return 'Pass'
  if (val === false) return 'Fail'
  return 'N/A'
}

function formatDateDDMMYYYY(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
  } catch {
    return dateStr
  }
}

/** Look up a reading value by label (case-insensitive, fuzzy prefix) */
function findReading(readings: AcbReportReading[], label: string): AcbReportReading | undefined {
  const lower = label.toLowerCase()
  return readings.find((r) => r.label.toLowerCase() === lower) ??
    readings.find((r) => r.label.toLowerCase().startsWith(lower))
}

/** Map CB detail attribute name to value from test record + readings */
function cbAttrValue(test: AcbReportTest, attrName: string): string {
  const a = attrName.toLowerCase()
  if (a === 'brand') return test.cbMake ?? ''
  if (a === 'breaker type') return test.cbModel ?? ''
  if (a === 'serial no') return test.cbSerial ?? ''

  // Try to find a matching reading
  const rdg = findReading(test.readings, attrName)
  return rdg ? rdg.value : ''
}

// ---------- section builders ----------

function buildHeaderTable(test: AcbReportTest, siteName: string): Table {
  const col1 = 1200
  const col2 = 3313
  const col3 = 900
  const col4 = 3613
  const totalW = col1 + col2 + col3 + col4

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [col1, col2, col3, col4],
    rows: [
      new TableRow({
        children: [
          cell('Site', col1, { bold: true, shading: 'D5E8F0' }),
          cell(siteName, col2),
          cell('Asset', col3, { bold: true, shading: 'D5E8F0' }),
          cell(test.assetName, col4),
        ],
      }),
      new TableRow({
        children: [
          cell('Location', col1, { bold: true, shading: 'D5E8F0' }),
          cell(test.location ?? '', col2),
          cell('ID', col3, { bold: true, shading: 'D5E8F0' }),
          cell(test.assetId ?? '', col4),
        ],
      }),
      new TableRow({
        children: [
          cell('Job Plan', col1, { bold: true, shading: 'D5E8F0' }),
          cell(test.jobPlan ?? '', col2),
          cell('', col3),
          cell('', col4),
        ],
      }),
    ],
  })
}

function buildCbDetailsTable(test: AcbReportTest): Table {
  // 4-column: Attribute | Value | Attribute | Value
  const c1 = 2400
  const c2 = 1800
  const c3 = 2600
  const c4 = 2226
  const totalW = c1 + c2 + c3 + c4

  const rows = CB_ATTR_ROWS.map(
    ([leftAttr, rightAttr]) =>
      new TableRow({
        children: [
          cell(leftAttr, c1, { bold: true }),
          cell(cbAttrValue(test, leftAttr), c2),
          cell(rightAttr, c3, { bold: true }),
          cell(cbAttrValue(test, rightAttr), c4),
        ],
      }),
  )

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          headerCell('Attribute', c1),
          headerCell('Value', c2),
          headerCell('Attribute', c3),
          headerCell('Value', c4),
        ],
      }),
      ...rows,
    ],
  })
}

function buildVisualFunctionalQuickTable(test: AcbReportTest): Table {
  const c1 = 7026
  const c2 = 2000
  const totalW = c1 + c2

  const rows = VF_QUICK_ITEMS.map((item) => {
    const rdg = findReading(test.readings, item)
    return new TableRow({
      children: [
        cell(item, c1, { bold: true }),
        cell(rdg ? rdg.value : '', c2),
      ],
    })
  })

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: [
      new TableRow({
        children: [
          headerCell('Name', c1),
          headerCell('Result', c2),
        ],
      }),
      ...rows,
    ],
  })
}

function buildVisualFunctionalChecklistTable(test: AcbReportTest): Table {
  const c1 = 3800
  const c2 = 700
  const c3 = 2200
  const c4 = 1000
  const c5 = 1326
  const totalW = c1 + c2 + c3 + c4 + c5

  const rows = VF_CHECKLIST.map((item) => {
    const rdg = findReading(test.readings, item.name)
    return new TableRow({
      children: [
        cell(item.name, c1),
        cell(String(item.order), c2),
        cell(item.section, c3),
        cell(rdg ? passFailText(rdg.isPass) : '', c4),
        cell(rdg && rdg.value !== passFailText(rdg.isPass) ? rdg.value : '', c5),
      ],
    })
  })

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4, c5],
    rows: [
      new TableRow({
        children: [
          headerCell('Name', c1),
          headerCell('Order', c2),
          headerCell('ACB Checklist Section', c3),
          headerCell('Result', c4),
          headerCell('Comment', c5),
        ],
      }),
      ...rows,
    ],
  })
}

function buildElectricalTestingSection(test: AcbReportTest): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  // Sub-heading: Electrical Testing
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text: `${test.assetName} - Electrical Testing`, bold: true, size: 22, font: 'Plus Jakarta Sans' })],
  }))

  // -- Main Contact Resistance --
  const contactColW = Math.floor(CONTENT_WIDTH / 3)
  const contactRows = [
    new TableRow({
      children: ET_CONTACT_PHASES.map((phase) => {
        const rdg = findReading(test.readings, `Contact Resistance ${phase}`) ?? findReading(test.readings, phase)
        return cell(`${phase}: ${rdg ? rdg.value : ''}`, contactColW)
      }),
    }),
  ]

  children.push(new Paragraph({
    spacing: { before: 120, after: 60 },
    children: [new TextRun({ text: 'Main Contact Resistance \u2014 All results are in MicroOhms', bold: true, size: 18, font: 'Plus Jakarta Sans' })],
  }))

  children.push(new Table({
    width: { size: contactColW * 3, type: WidthType.DXA },
    columnWidths: [contactColW, contactColW, contactColW],
    rows: [
      new TableRow({
        children: ET_CONTACT_PHASES.map((p) => headerCell(p, contactColW)),
      }),
      ...contactRows,
    ],
  }))

  // -- Insulation Resistance Closed --
  const irColW = Math.floor(CONTENT_WIDTH / 3)
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Insulation Resistance - Closed', bold: true, size: 18, font: 'Plus Jakarta Sans' })],
  }))

  // 3 columns, 3 rows
  const irClosedTableRows: TableRow[] = []
  for (let row = 0; row < 3; row++) {
    const rowCells = [0, 1, 2].map((col) => {
      const label = ET_IR_CLOSED[row * 3 + col]
      if (!label) return cell('', irColW)
      const rdg = findReading(test.readings, `IR Closed ${label}`) ?? findReading(test.readings, label)
      return cell(`${label}: ${rdg ? rdg.value : ''}`, irColW)
    })
    irClosedTableRows.push(new TableRow({ children: rowCells }))
  }

  children.push(new Table({
    width: { size: irColW * 3, type: WidthType.DXA },
    columnWidths: [irColW, irColW, irColW],
    rows: irClosedTableRows,
  }))

  // -- Insulation Resistance Open --
  const irOpenColW = Math.floor(CONTENT_WIDTH / 2)
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Insulation Resistance - Open', bold: true, size: 18, font: 'Plus Jakarta Sans' })],
  }))

  const irOpenTableRows: TableRow[] = []
  for (let row = 0; row < 2; row++) {
    const rowCells = [0, 1].map((col) => {
      const label = ET_IR_OPEN[row * 2 + col]
      if (!label) return cell('', irOpenColW)
      const rdg = findReading(test.readings, `IR Open ${label}`) ?? findReading(test.readings, label)
      return cell(`${label}: ${rdg ? rdg.value : ''}`, irOpenColW)
    })
    irOpenTableRows.push(new TableRow({ children: rowCells }))
  }

  children.push(new Table({
    width: { size: irOpenColW * 2, type: WidthType.DXA },
    columnWidths: [irOpenColW, irOpenColW],
    rows: irOpenTableRows,
  }))

  // -- Secondary Injection + Operation Counter After --
  const siRdg = findReading(test.readings, 'Secondary Injection')
  const ocAfterRdg = findReading(test.readings, 'Operation Counter - After') ?? findReading(test.readings, 'Operation Counter After')

  children.push(new Paragraph({
    spacing: { before: 120 },
    children: [
      new TextRun({ text: 'Carry Out Secondary Injection Test Using Software: ', bold: true, size: 18, font: 'Plus Jakarta Sans' }),
      new TextRun({ text: siRdg ? siRdg.value : '', size: 18, font: 'Plus Jakarta Sans' }),
    ],
  }))

  children.push(new Paragraph({
    spacing: { before: 60 },
    children: [
      new TextRun({ text: 'Operation Counter - After: ', bold: true, size: 18, font: 'Plus Jakarta Sans' }),
      new TextRun({ text: ocAfterRdg ? ocAfterRdg.value : '', size: 18, font: 'Plus Jakarta Sans' }),
    ],
  }))

  return children
}

function buildProtectionResultsTable(test: AcbReportTest): Table {
  const c1 = 1500
  const c2 = 1700
  const c3 = 1400
  const c4 = 1500
  const c5 = 1500
  const c6 = 1426
  const totalW = c1 + c2 + c3 + c4 + c5 + c6

  const rows = PROTECTION_ROWS.map((protection) => {
    const rdg = findReading(test.readings, `Protection ${protection}`)
    return new TableRow({
      children: [
        cell(protection, c1, { bold: true }),
        cell(rdg?.value ?? '', c2), // current levels
        cell('', c3), // trip time
        cell('', c4), // min trip
        cell('', c5), // max trip
        cell(rdg ? passFailText(rdg.isPass) : 'N/A', c6),
      ],
    })
  })

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4, c5, c6],
    rows: [
      new TableRow({
        children: [
          headerCell('Protections', c1),
          headerCell('Current Levels (A)', c2),
          headerCell('Trip Time (s)', c3),
          headerCell('Minimum trip time', c4),
          headerCell('Maximum trip time', c5),
          headerCell('Pass / Fail', c6),
        ],
      }),
      ...rows,
    ],
  })
}

// ---------- cover page ----------

function buildCoverSection(input: AcbReportInput): { children: (Paragraph | Table)[] } {
  const year = new Date().getFullYear()
  const today = formatDateDDMMYYYY(new Date().toISOString())
  const brand = input.primaryColour.replace('#', '')
  const coverLogo = input.logoImageOnLight ?? input.logoImage ?? input.logoImageOnDark

  const children: (Paragraph | Table)[] = []

  // Logo (if provided) — renders above the title on light surface
  if (coverLogo) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 },
      children: [new ImageRun({
        type: coverLogo.type,
        data: coverLogo.data,
        transformation: { width: coverLogo.width, height: coverLogo.height },
        altText: { title: 'Company Logo', description: 'Company logo', name: 'company-logo' },
      })],
    }))
  }

  return {
    children: [
      ...children,
      // spacer
      new Paragraph({ spacing: { before: coverLogo ? 800 : 4000 } }),
      // site + title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({
          text: `${input.siteName} - ACB Test List - ${year}`,
          bold: true,
          size: 52,
          font: 'Plus Jakarta Sans',
          color: brand,
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({
          text: `Report Generated: ${today}`,
          italics: true,
          size: 24,
          font: 'Plus Jakarta Sans',
          color: '666666',
        })],
      }),
      // spacer
      new Paragraph({ spacing: { before: 2000 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: input.siteName,
          bold: true,
          size: 36,
          font: 'Plus Jakarta Sans',
        })],
      }),
      // large spacer to fill page
      new Paragraph({ spacing: { before: 3000 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: input.tenantProductName,
          size: 20,
          font: 'Plus Jakarta Sans',
          color: '999999',
        })],
      }),
      // page break (via next section)
    ],
  }
}

// ---------- per-breaker section ----------

function buildBreakerSection(test: AcbReportTest, siteName: string, index: number, complexity: 'summary' | 'standard' | 'detailed' = 'standard'): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const label = test.assetName

  // H1 — breaker heading (with bookmark for TOC)
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: index > 0,
    children: [
      new Bookmark({
        id: `breaker_${index}`,
        children: [new TextRun({ text: label, bold: true, size: 28, font: 'Plus Jakarta Sans' })],
      }),
    ],
  }))

  // Header table
  children.push(buildHeaderTable(test, siteName))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  // H2 — CB Details
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Circuit Breaker Details`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
  }))
  children.push(buildCbDetailsTable(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  // H2 — Visual / Functional
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Visual / Functional Test Results`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
  }))
  children.push(buildVisualFunctionalQuickTable(test))
  children.push(new Paragraph({ spacing: { before: 60 } }))
  children.push(buildVisualFunctionalChecklistTable(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  // Electrical Testing
  children.push(...buildElectricalTestingSection(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  // H2 — Protection Test Results
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Protection Test Results`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
  }))
  children.push(buildProtectionResultsTable(test))

  // Detailed: include notes section
  if (complexity === 'detailed' && test.notes) {
    children.push(new Paragraph({ spacing: { before: 120 } }))
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `${label} - Notes & Commentary`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
    }))
    children.push(new Paragraph({
      spacing: { before: 60 },
      children: [new TextRun({ text: test.notes, size: 20, font: 'Plus Jakarta Sans' })],
    }))
  }

  return children
}

// ---------- summary table (for summary complexity) ----------

function buildSummaryTable(input: AcbReportInput): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  // Summary heading
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: 'Test Results Summary', bold: true, size: 28, font: 'Plus Jakarta Sans' })],
  }))
  children.push(new Paragraph({
    spacing: { before: 60, after: 120 },
    children: [new TextRun({ text: `${input.tests.length} circuit breakers tested at ${input.siteName}`, size: 20, font: 'Plus Jakarta Sans', color: '666666' })],
  }))

  // KPI row
  const total = input.tests.length
  const passed = input.tests.filter(t => t.overallResult === 'Pass').length
  const failed = input.tests.filter(t => t.overallResult === 'Fail').length
  const defect = input.tests.filter(t => t.overallResult === 'Defect').length
  const pending = total - passed - failed - defect

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [Math.floor(CONTENT_WIDTH / 4), Math.floor(CONTENT_WIDTH / 4), Math.floor(CONTENT_WIDTH / 4), CONTENT_WIDTH - Math.floor(CONTENT_WIDTH / 4) * 3],
    rows: [
      new TableRow({
        children: [
          kpiCell('Total', String(total), 'EAF5FB'),
          kpiCell('Pass', String(passed), 'DCFCE7'),
          kpiCell('Fail', String(failed), failed > 0 ? 'FEE2E2' : 'F3F4F6'),
          kpiCell('Defect', String(defect), defect > 0 ? 'FEF3C7' : 'F3F4F6'),
        ],
      }),
    ],
  }))

  children.push(new Paragraph({ spacing: { before: 200 } }))

  // Results table — one row per breaker
  const colWidths = [3500, 1800, 1200, 1200, 1326]
  const headerRow = new TableRow({
    children: ['Asset', 'Make / Model', 'Date', 'Result', 'Tested By'].map((text, ci) =>
      new TableCell({
        borders: BORDERS,
        width: { size: colWidths[ci], type: WidthType.DXA },
        margins: CELL_MARGINS,
        shading: { fill: 'F3F4F6', type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: 'Plus Jakarta Sans' })] })],
      })
    ),
  })

  const dataRows = input.tests.map(t => {
    const resultColour = t.overallResult === 'Pass' ? 'DCFCE7' : t.overallResult === 'Fail' ? 'FEE2E2' : t.overallResult === 'Defect' ? 'FEF3C7' : 'FFFFFF'
    return new TableRow({
      children: [
        textCell(t.assetName, colWidths[0]),
        textCell([t.cbMake, t.cbModel].filter(Boolean).join(' ') || '—', colWidths[1]),
        textCell(fmtDate(t.testDate), colWidths[2]),
        new TableCell({
          borders: BORDERS,
          width: { size: colWidths[3], type: WidthType.DXA },
          margins: CELL_MARGINS,
          shading: { fill: resultColour, type: ShadingType.CLEAR },
          children: [new Paragraph({ children: [new TextRun({ text: t.overallResult, bold: true, size: 18, font: 'Plus Jakarta Sans' })] })],
        }),
        textCell(t.testedBy ?? '—', colWidths[4]),
      ],
    })
  })

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  }))

  return children
}

function kpiCell(label: string, value: string, fill: string): TableCell {
  return new TableCell({
    borders: BORDERS,
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    shading: { fill, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: value, bold: true, size: 36, font: 'Plus Jakarta Sans' })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: label, size: 16, font: 'Plus Jakarta Sans', color: '666666' })],
      }),
    ],
  })
}

function textCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text, size: 18, font: 'Plus Jakarta Sans' })] })],
  })
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return d }
}

// ---------- main export ----------

export async function generateAcbReport(input: AcbReportInput): Promise<Buffer> {
  const brand = input.primaryColour.replace('#', '')
  const complexity = input.complexity ?? 'standard'
  const showCover = input.showCoverPage ?? true
  const showContents = input.showContents ?? true

  const coverChildren = showCover ? buildCoverSection(input).children : []

  // TOC section (skip for summary)
  const tocChildren: (Paragraph | Table | TableOfContents)[] = (showContents && complexity !== 'summary') ? [
    new Paragraph({ children: [new PageBreak()] }),
    new TableOfContents('Table of Contents', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ] : []

  // Summary: one-page results table instead of full breaker sections
  // Standard: full breaker sections
  // Detailed: full breaker sections + notes
  const breakerChildren: (Paragraph | Table)[] = []
  if (complexity === 'summary') {
    breakerChildren.push(...buildSummaryTable(input))
  } else {
    input.tests.forEach((test, i) => {
      breakerChildren.push(...buildBreakerSection(test, input.siteName, i, complexity))
    })
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Plus Jakarta Sans', size: 20 },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, font: 'Plus Jakarta Sans', color: brand },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: 'Plus Jakarta Sans', color: '333333' },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 22, bold: true, font: 'Plus Jakarta Sans', color: '444444' },
          paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [
      // Cover page (conditional)
      ...(showCover ? [{
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children: coverChildren,
      }] : []),
      // TOC + content
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: input.customHeaderText ?? `${input.siteName} \u2014 ACB Test Report`, size: 16, font: 'Plus Jakarta Sans', color: '999999' })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Page ', size: 16, font: 'Plus Jakarta Sans', color: '999999' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Plus Jakarta Sans', color: '999999' }),
                ],
              }),
            ],
          }),
        },
        children: [...tocChildren, ...breakerChildren],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
