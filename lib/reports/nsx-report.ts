/**
 * NSX Test Report — DOCX Generator
 *
 * Produces a per-site MCCB/NSX test report:
 *   Cover → TOC → per-breaker sections (CB details, visual checks,
 *   electrical testing, trip test results).
 *
 * Simpler structure than ACB — no racking, fewer visual checks.
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
} from 'docx'

// ---------- types ----------

export interface NsxReportInput {
  siteName: string
  siteCode: string | null
  tenantProductName: string
  primaryColour: string
  tests: NsxReportTest[]
}

export interface NsxReportTest {
  assetName: string
  assetType: string
  location: string | null
  assetId: string | null
  testDate: string
  testedBy: string | null
  testType: string
  cbMake: string | null
  cbModel: string | null
  cbSerial: string | null
  cbRating: string | null
  cbPoles: string | null
  tripUnit: string | null
  overallResult: string
  notes: string | null
  readings: NsxReportReading[]
}

export interface NsxReportReading {
  label: string
  value: string
  unit: string | null
  isPass: boolean | null
  sortOrder: number
}

// ---------- constants ----------

const PAGE_WIDTH = 11906
const PAGE_HEIGHT = 16838
const MARGIN = 1440
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 }

// CB detail attributes (left, right)
const CB_ATTR_ROWS: [string, string][] = [
  ['Brand', 'Trip Unit'],
  ['Model', 'Current Rating'],
  ['Serial No', 'Number of Poles'],
  ['Breaker Type', 'Fixed / Withdrawable'],
  ['Performance Level', 'Long Time - Ir'],
  ['Protection Unit Fitted', 'Long Time Delay - tr'],
  ['Short-Time Pickup - Isd', 'Instantaneous Pickup - Ii'],
  ['Earth-Fault Pickup - Ig', 'Earth-Leakage Tripping Delay'],
]

// Visual/functional checklist for MCCB
const VF_CHECKLIST: { name: string; section: string }[] = [
  { name: 'General Condition', section: 'Visual Inspection' },
  { name: 'Condition of connection pads', section: 'Visual Inspection' },
  { name: 'Main contact wear indicator', section: 'Visual Inspection' },
  { name: 'Condition of the ARC chute', section: 'Visual Inspection' },
  { name: 'Connection pads cleaning', section: 'Mechanical' },
  { name: 'Manual trip test', section: 'Functional Check' },
  { name: 'Manual close test', section: 'Functional Check' },
  { name: 'Manual open test', section: 'Functional Check' },
  { name: 'OF/SD auxiliary contact check', section: 'Functional Check' },
  { name: 'Shunt trip (MX) test', section: 'Functional Check' },
  { name: 'Undervoltage (MN) test', section: 'Functional Check' },
  { name: 'Motor operator test', section: 'Functional Check' },
  { name: 'Pull test on auxiliary wiring', section: 'Auxiliaries' },
  { name: 'Apply service sticker', section: 'Completion' },
  { name: 'Connection pads greasing', section: 'Completion' },
  { name: 'Additional information / items to be actioned', section: 'Overall' },
]

const ET_CONTACT_PHASES = ['Red Phase', 'Blue Phase', 'White Phase']
const ET_IR_CLOSED = [
  'Red > White', 'Red > Earth', 'Blue > Neutral',
  'Red > Blue', 'White > Earth', 'Red > Neutral',
  'White > Blue', 'Blue > Earth', 'White > Neutral',
]
const ET_IR_OPEN = ['Red > Red', 'White > White', 'Blue > Blue', 'Neutral > Neutral']

const TRIP_TEST_ROWS = ['Long time', 'Short time', 'Instantaneous', 'Earth fault']

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

function findReading(readings: NsxReportReading[], label: string): NsxReportReading | undefined {
  const lower = label.toLowerCase()
  return readings.find((r) => r.label.toLowerCase() === lower) ??
    readings.find((r) => r.label.toLowerCase().startsWith(lower))
}

function cbAttrValue(test: NsxReportTest, attrName: string): string {
  const a = attrName.toLowerCase()
  if (a === 'brand') return test.cbMake ?? ''
  if (a === 'model') return test.cbModel ?? ''
  if (a === 'serial no') return test.cbSerial ?? ''
  if (a === 'current rating') return test.cbRating ?? ''
  if (a === 'number of poles') return test.cbPoles ?? ''
  if (a === 'trip unit') return test.tripUnit ?? ''
  const rdg = findReading(test.readings, attrName)
  return rdg ? rdg.value : ''
}

// ---------- section builders ----------

function buildHeaderTable(test: NsxReportTest, siteName: string): Table {
  const c1 = 1200
  const c2 = 3313
  const c3 = 900
  const c4 = 3613
  const totalW = c1 + c2 + c3 + c4

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          cell('Site', c1, { bold: true, shading: 'D5E8F0' }),
          cell(siteName, c2),
          cell('Asset', c3, { bold: true, shading: 'D5E8F0' }),
          cell(test.assetName, c4),
        ],
      }),
      new TableRow({
        children: [
          cell('Location', c1, { bold: true, shading: 'D5E8F0' }),
          cell(test.location ?? '', c2),
          cell('ID', c3, { bold: true, shading: 'D5E8F0' }),
          cell(test.assetId ?? '', c4),
        ],
      }),
    ],
  })
}

function buildCbDetailsTable(test: NsxReportTest): Table {
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

function buildVisualChecklistTable(test: NsxReportTest): Table {
  const c1 = 4000
  const c2 = 2200
  const c3 = 1000
  const c4 = 1826
  const totalW = c1 + c2 + c3 + c4

  const rows = VF_CHECKLIST.map((item) => {
    const rdg = findReading(test.readings, item.name)
    return new TableRow({
      children: [
        cell(item.name, c1),
        cell(item.section, c2),
        cell(rdg ? passFailText(rdg.isPass) : '', c3),
        cell(rdg && rdg.value !== passFailText(rdg.isPass) ? rdg.value : '', c4),
      ],
    })
  })

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          headerCell('Check Item', c1),
          headerCell('Section', c2),
          headerCell('Result', c3),
          headerCell('Comment', c4),
        ],
      }),
      ...rows,
    ],
  })
}

function buildElectricalTestingSection(test: NsxReportTest): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text: `${test.assetName} - Electrical Testing`, bold: true, size: 22, font: 'Plus Jakarta Sans' })],
  }))

  // Contact Resistance
  const contactColW = Math.floor(CONTENT_WIDTH / 3)
  children.push(new Paragraph({
    spacing: { before: 120, after: 60 },
    children: [new TextRun({ text: 'Main Contact Resistance \u2014 All results in MicroOhms', bold: true, size: 18, font: 'Plus Jakarta Sans' })],
  }))

  children.push(new Table({
    width: { size: contactColW * 3, type: WidthType.DXA },
    columnWidths: [contactColW, contactColW, contactColW],
    rows: [
      new TableRow({
        children: ET_CONTACT_PHASES.map((p) => headerCell(p, contactColW)),
      }),
      new TableRow({
        children: ET_CONTACT_PHASES.map((phase) => {
          const rdg = findReading(test.readings, `Contact Resistance ${phase}`) ?? findReading(test.readings, phase)
          return cell(rdg ? rdg.value : '', contactColW)
        }),
      }),
    ],
  }))

  // IR Closed
  const irColW = Math.floor(CONTENT_WIDTH / 3)
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Insulation Resistance - Closed', bold: true, size: 18, font: 'Plus Jakarta Sans' })],
  }))

  const irClosedRows: TableRow[] = []
  for (let row = 0; row < 3; row++) {
    const rowCells = [0, 1, 2].map((col) => {
      const label = ET_IR_CLOSED[row * 3 + col]
      if (!label) return cell('', irColW)
      const rdg = findReading(test.readings, `IR Closed ${label}`) ?? findReading(test.readings, label)
      return cell(`${label}: ${rdg ? rdg.value : ''}`, irColW)
    })
    irClosedRows.push(new TableRow({ children: rowCells }))
  }

  children.push(new Table({
    width: { size: irColW * 3, type: WidthType.DXA },
    columnWidths: [irColW, irColW, irColW],
    rows: irClosedRows,
  }))

  // IR Open
  const irOpenColW = Math.floor(CONTENT_WIDTH / 2)
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Insulation Resistance - Open', bold: true, size: 18, font: 'Plus Jakarta Sans' })],
  }))

  const irOpenRows: TableRow[] = []
  for (let row = 0; row < 2; row++) {
    const rowCells = [0, 1].map((col) => {
      const label = ET_IR_OPEN[row * 2 + col]
      if (!label) return cell('', irOpenColW)
      const rdg = findReading(test.readings, `IR Open ${label}`) ?? findReading(test.readings, label)
      return cell(`${label}: ${rdg ? rdg.value : ''}`, irOpenColW)
    })
    irOpenRows.push(new TableRow({ children: rowCells }))
  }

  children.push(new Table({
    width: { size: irOpenColW * 2, type: WidthType.DXA },
    columnWidths: [irOpenColW, irOpenColW],
    rows: irOpenRows,
  }))

  return children
}

function buildTripTestTable(test: NsxReportTest): Table {
  const c1 = 1500
  const c2 = 1700
  const c3 = 1400
  const c4 = 1500
  const c5 = 1500
  const c6 = 1426
  const totalW = c1 + c2 + c3 + c4 + c5 + c6

  const rows = TRIP_TEST_ROWS.map((protection) => {
    const rdg = findReading(test.readings, `Trip ${protection}`) ?? findReading(test.readings, protection)
    return new TableRow({
      children: [
        cell(protection, c1, { bold: true }),
        cell(rdg?.value ?? '', c2),
        cell('', c3),
        cell('', c4),
        cell('', c5),
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
          headerCell('Protection', c1),
          headerCell('Current Levels (A)', c2),
          headerCell('Trip Time (s)', c3),
          headerCell('Min trip time', c4),
          headerCell('Max trip time', c5),
          headerCell('Pass / Fail', c6),
        ],
      }),
      ...rows,
    ],
  })
}

// ---------- per-breaker section ----------

function buildBreakerSection(test: NsxReportTest, siteName: string, index: number): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const label = test.assetName

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

  children.push(buildHeaderTable(test, siteName))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Circuit Breaker Details`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
  }))
  children.push(buildCbDetailsTable(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Visual / Functional Checks`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
  }))
  children.push(buildVisualChecklistTable(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(...buildElectricalTestingSection(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Trip Test Results`, bold: true, size: 24, font: 'Plus Jakarta Sans' })],
  }))
  children.push(buildTripTestTable(test))

  return children
}

// ---------- main export ----------

export async function generateNsxReport(input: NsxReportInput): Promise<Buffer> {
  const brand = input.primaryColour.replace('#', '')
  const year = new Date().getFullYear()
  const today = formatDateDDMMYYYY(new Date().toISOString())

  const coverChildren: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { before: 4000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({
        text: `${input.siteName} - NSX / MCCB Test List - ${year}`,
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
  ]

  const tocChildren: (Paragraph | Table | TableOfContents)[] = [
    new Paragraph({ children: [new PageBreak()] }),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
    new Paragraph({ children: [new PageBreak()] }),
  ]

  const breakerChildren: (Paragraph | Table)[] = []
  input.tests.forEach((test, i) => {
    breakerChildren.push(...buildBreakerSection(test, input.siteName, i))
  })

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Plus Jakarta Sans', size: 20 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Plus Jakarta Sans', color: brand },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Plus Jakarta Sans', color: '333333' },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, font: 'Plus Jakarta Sans', color: '444444' },
          paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children: coverChildren,
      },
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
                children: [new TextRun({ text: `${input.siteName} \u2014 NSX / MCCB Test Report`, size: 16, font: 'Plus Jakarta Sans', color: '999999' })],
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
