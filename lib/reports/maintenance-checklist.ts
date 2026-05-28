/**
 * Maintenance Checklist — Printable DOCX Generator
 *
 * Generates a printer-friendly checklist for site teams to complete by hand.
 * Features:
 * - Black & white friendly (no color backgrounds)
 * - Clear checkbox squares for hand-ticking
 * - Per-asset sections with task checklists
 * - Space for handwritten comments
 * - Completion signature block at bottom of each page
 * - Compact and practical for clipboard use
 */

import {
  Document,
  Footer,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  PageBreak,
  VerticalAlign,
  ImageRun,
} from 'docx'
import { buildMasthead } from '@/lib/reports/report-branding'
import {
  buildHeader as buildShellHeader,
  prepareShell,
  resolveShellSettings,
} from '@/lib/reports/report-shell'
import { FONT_BODY, FONT_HEADING as FONT_HEADING_TOKEN } from '@/lib/reports/typography'
import { EQ_WHITE, EQ_MID_GREY, bareHex, tenantIce, adjustHex } from '@/lib/reports/colours'

// ─────────── Types ───────────

export interface MaintenanceChecklistInput {
  // Tenant branding
  companyName: string
  /** Optional ABN — appears in the footer next to companyName when supplied. */
  companyAbn?: string | null
  checkName: string
  siteName: string
  dueDate: string
  frequency: string
  assignedTo: string | null
  maximoWONumber: string | null
  maximoPMNumber: string | null
  printedDate: string

  // Assets with tasks
  assets: ChecklistAsset[]

  // Company branding
  tenantProductName: string
  reportTypeLabel?: string        // Phase 1: report type label for display

  // Phase 1: logos for masthead
  tenantLogoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | null
  customerLogoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | null
  primaryColour?: string          // hex color for masthead

  /**
   * Optional tenant-set palette overrides. When supplied (from
   * tenant_settings.deep_colour / ice_colour / ink_colour, the values the
   * tenant set via Admin → Tenant Settings → Branding → Extract Colours),
   * the generator uses these exact values for accent surfaces and ice
   * fills. When null/undefined, derives ice from primaryColour and uses
   * EQ_INK for body text.
   */
  deepColour?: string | null
  iceColour?: string | null
  inkColour?: string | null

  /**
   * Detail level (Sprint 2 — three-tier styles, mirrors Report Settings):
   *   - 'simple'   → asset register only, single page (legacy alias 'summary').
   *   - 'standard' → asset register + per-asset task headings (default for Print Report).
   *   - 'detailed' → full task-by-task breakdown with comment space per task.
   *
   * Generator currently treats 'standard' as 'detailed' until a slimmed-down
   * template is built. Type accepts all three so the API contract is stable.
   */
  format?: 'simple' | 'standard' | 'detailed'
}

export interface ChecklistAsset {
  assetName: string
  assetId: string                    // Maximo ID
  location: string
  workOrderNumber: string | null
  tasks: ChecklistTask[]
  notes: string | null
  /** When set, renders a structured 3-section breaker form instead of the generic task table. */
  testKind?: 'acb' | 'nsx'
}

export interface ChecklistTask {
  order: number
  description: string
}

// ─────────── Constants ───────────

// True A4 landscape: 297mm × 210mm = 11.69" × 8.27" = 16838 × 11906 DXA.
// Previous value (13338) gave a 9.26"-wide page that cramped the asset
// register against the right edge — Royce's "page 2 needs proper landscape"
// feedback 2026-04-29.
const PAGE_WIDTH = 16838   // A4 landscape long edge DXA (~11.69")
const PAGE_HEIGHT = 11906  // A4 landscape short edge DXA (~8.27")
const MARGIN = 720         // ~0.5 inch (12.7mm)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

// Local aliases keep the existing inline references readable; sources of
// truth are FONT_BODY / FONT_HEADING_TOKEN from lib/reports/typography.ts
// per Brief v1.3 §6.2.
const FONT = FONT_BODY
const FONT_HEADING = FONT_HEADING_TOKEN

const BORDER_STANDARD = { style: BorderStyle.SINGLE, size: 6, color: '000000' } as const
const BORDERS_STANDARD = { top: BORDER_STANDARD, bottom: BORDER_STANDARD, left: BORDER_STANDARD, right: BORDER_STANDARD }
// `BorderStyle.NONE` works as a runtime value but the docx type narrows
// to non-NONE for ITableCellBorders — `satisfies` over `as any` keeps
// type-checking on the rest of the literal.
const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const
const BORDERS_NONE: typeof BORDERS_STANDARD = {
  top: BORDER_NONE as unknown as typeof BORDER_STANDARD,
  bottom: BORDER_NONE as unknown as typeof BORDER_STANDARD,
  left: BORDER_NONE as unknown as typeof BORDER_STANDARD,
  right: BORDER_NONE as unknown as typeof BORDER_STANDARD,
}
const CELL_PAD = { top: 80, bottom: 80, left: 100, right: 100 }
const CELL_PAD_TIGHT = { top: 40, bottom: 40, left: 80, right: 80 }

// ─────────── Helpers ───────────

function makeCell(text: string, width: number, opts?: { bold?: boolean; color?: string; borders?: typeof BORDERS_STANDARD; size?: number; shading?: string }): TableCell {
  return new TableCell({
    borders: opts?.borders ?? BORDERS_STANDARD,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_PAD,
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: opts?.bold,
        size: opts?.size ?? 20,
        font: FONT,
        color: opts?.color,
      })]
    })],
  })
}

function makeCheckboxCell(width: number): TableCell {
  // Empty checkbox: □
  return new TableCell({
    borders: BORDERS_STANDARD,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_PAD_TIGHT,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '☐', size: 28, font: FONT })]
    })],
  })
}

function spacer(pts = 200): Paragraph {
  return new Paragraph({ spacing: { before: pts } })
}

/**
 * Brand-coloured horizontal rule used between the master register and the
 * detail cards (standard format) so the supervisor → tech handover lands
 * with a visible accent. PR L (2026-04-28 subtle branding).
 */
function buildBrandedRule(brandHex: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 18, color: brandHex, space: 4 },
    },
  })
}

/**
 * Run-sheet specific footer. Mirrors the shared shell footer's layout but
 * uses the tenant brand colour for the page numbers (subtle accent) and
 * appends the company ABN to the left text when supplied. The rest of the
 * footer line stays mid-grey to keep the body content the visual focus.
 *
 * Built locally rather than extending report-shell.buildFooter so other
 * report types (pm-asset, acb, nsx, compliance) keep their grey page
 * numbers. PR L — subtle branding scoped to the run-sheet only.
 */
function buildBrandedRunSheetFooter(input: MaintenanceChecklistInput, brandHex: string): Footer {
  const company = input.companyName ?? input.tenantProductName
  const reportTypeLabel = input.reportTypeLabel || 'Field Run-Sheet'
  const abnPart = input.companyAbn ? `  ·  ABN ${input.companyAbn}` : ''
  const left = `${company}${abnPart} — ${reportTypeLabel}`

  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({ text: left, size: 14, font: FONT, color: EQ_MID_GREY }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: 'Page ', size: 14, font: FONT, color: EQ_MID_GREY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, font: FONT, color: brandHex, bold: true }),
          new TextRun({ text: ' of ', size: 14, font: FONT, color: EQ_MID_GREY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, font: FONT, color: brandHex, bold: true }),
        ],
      }),
    ],
  })
}

function divider(): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
  })
}

// ─────────── Header & Footer ───────────
// Local buildHeader/buildFooter functions removed 26-Apr-2026 — replaced by
// the shared report-shell.ts module (see Sprint 2.3 + audit cleanup).

// ─────────── Info Block ───────────

function buildInfoBlock(input: MaintenanceChecklistInput): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  // Brand strip (audit Q3): a thin tenant-coloured band at the very top of
  // page 1 with the tenant logo and report type. Body content below stays
  // black-and-white for tick-friendly photocopying. The strip alone is
  // enough to make the document recognisably tenant-branded without
  // compromising printability.
  const brandHex = bareHex(input.primaryColour ?? '3DA8D8')
  // 2026-04-28 (Royce review issue 6 + later "flat colours, logo pop"):
  // The strip fill was previously derived from tenantDeep, which honours
  // the explicit deep_colour override on tenant_settings. SKS sets
  // deep_colour to navy #1F335C — readable but generic. Royce wanted the
  // SKS brand purple (#7C77B9) on the strip, just darker so the white
  // logo pops. Auto-darken the primary directly (-0.20) and ignore the
  // deep override for this surface. White logo reads cleanly on any
  // tenant's darkened primary.
  const stripFillHex = adjustHex(bareHex(input.primaryColour ?? '3DA8D8'), -0.20)
  const stripCellMargins = { top: 120, bottom: 120, left: 200, right: 200 }
  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [Math.floor(CONTENT_WIDTH * 0.6), Math.ceil(CONTENT_WIDTH * 0.4)],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: BORDERS_NONE,
            width: { size: Math.floor(CONTENT_WIDTH * 0.6), type: WidthType.DXA },
            shading: { fill: stripFillHex, type: ShadingType.CLEAR },
            margins: stripCellMargins,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              children: input.tenantLogoImage
                ? [new ImageRun({
                    data: input.tenantLogoImage.data,
                    transformation: { width: input.tenantLogoImage.width, height: input.tenantLogoImage.height },
                    type: input.tenantLogoImage.type,
                  })]
                : [new TextRun({
                    text: input.companyName ?? input.tenantProductName,
                    bold: true,
                    size: 24,
                    color: EQ_WHITE,
                    font: FONT_HEADING,
                  })],
            })],
          }),
          new TableCell({
            borders: BORDERS_NONE,
            width: { size: Math.ceil(CONTENT_WIDTH * 0.4), type: WidthType.DXA },
            shading: { fill: stripFillHex, type: ShadingType.CLEAR },
            margins: stripCellMargins,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({
                text: input.reportTypeLabel || 'Field Run-Sheet',
                bold: true,
                size: 24,
                color: EQ_WHITE,
                font: FONT_HEADING,
              })],
            })],
          }),
        ],
      }),
    ],
  }))
  children.push(spacer(200))

  // Customer logo masthead (only if customer logo present — keeps the
  // branding clear: tenant on the strip, customer below it).
  if (input.customerLogoImage) {
    children.push(
      buildMasthead({
        customerLogo: input.customerLogoImage,
        reportTypeLabel: undefined,
      }),
    )
  }

  // Title — uses tenant brand colour so the title carries the same identity
  // as the brand strip above it.
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({
      text: `${input.checkName}`,
      size: 32,
      font: FONT_HEADING,
      bold: true,
      color: brandHex,
    })]
  }))

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({
      text: `${input.siteName}`,
      size: 24,
      font: FONT,
      color: EQ_MID_GREY,
    })]
  }))

  // Info table: 2 columns
  const c1 = 2800
  const c2 = 4200
  const tw = c1 + c2

  const infoRows: [string, string][] = [
    ['Due Date', input.dueDate || '—'],
    ['Frequency', input.frequency || '—'],
    ['Assigned To', input.assignedTo || 'Unassigned'],
    ['Date Printed', input.printedDate],
  ]

  if (input.maximoWONumber) infoRows.push(['Maximo WO #', input.maximoWONumber])
  if (input.maximoPMNumber) infoRows.push(['Maximo PM #', input.maximoPMNumber])

  // Info table — labels in tenant brand colour for visual consistency
  // with the title.
  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: infoRows.map(([label, value]) =>
      new TableRow({
        children: [
          makeCell(label, c1, { bold: true, size: 18, color: brandHex }),
          makeCell(value, c2, { size: 18 }),
        ],
      })
    ),
  }))

  children.push(spacer(200))
  children.push(divider())

  return children
}

// ─────────── ACB / NSX Structured Breaker Card ───────────

const ACB_VISUAL_ITEMS: { label: string; section: string }[] = [
  { label: 'General condition / cleanliness', section: 'Visual Inspection' },
  { label: 'Arc chute condition', section: 'Visual Inspection' },
  { label: 'Main contact condition', section: 'Visual Inspection' },
  { label: 'Auxiliary contact condition', section: 'Visual Inspection' },
  { label: 'Mechanism lubrication', section: 'Service Operations' },
  { label: 'Racking mechanism operation', section: 'Service Operations' },
  { label: 'Spring charging mechanism', section: 'Service Operations' },
  { label: 'Chassis earthing contact', section: 'Functional Tests Chassis' },
  { label: 'Shutter operation', section: 'Functional Tests Chassis' },
  { label: 'Operations counter reading', section: 'Functional Tests Chassis' },
  { label: 'Manual close', section: 'Functional Tests Device' },
  { label: 'Manual open (trip free)', section: 'Functional Tests Device' },
  { label: 'Electrical close', section: 'Functional Tests Device' },
  { label: 'Electrical open', section: 'Functional Tests Device' },
  { label: 'Spring charge motor operation', section: 'Functional Tests Device' },
  { label: 'Anti-pump function', section: 'Functional Tests Device' },
  { label: 'Undervoltage release operation', section: 'Functional Tests Device' },
  { label: 'Shunt trip operation', section: 'Functional Tests Device' },
  { label: 'Closing solenoid operation', section: 'Functional Tests Device' },
  { label: 'Position indication (open/closed)', section: 'Functional Tests Device' },
  { label: 'Auxiliary switch operation', section: 'Functional Tests Device' },
  { label: 'Motor charge spring function', section: 'Auxiliaries' },
  { label: 'Communication module check', section: 'Auxiliaries' },
]

const NSX_VISUAL_ITEMS: { label: string; section: string }[] = [
  { label: 'General condition / cleanliness', section: 'Visual Inspection' },
  { label: 'Main contact condition', section: 'Visual Inspection' },
  { label: 'Auxiliary contact condition', section: 'Visual Inspection' },
  { label: 'Chassis earthing contact', section: 'Functional Tests' },
  { label: 'Manual close operation', section: 'Functional Tests' },
  { label: 'Manual open / trip free', section: 'Functional Tests' },
  { label: 'Electrical close (if fitted)', section: 'Functional Tests' },
  { label: 'Electrical open (if fitted)', section: 'Functional Tests' },
  { label: 'Undervoltage release (if fitted)', section: 'Functional Tests' },
  { label: 'Shunt trip operation (if fitted)', section: 'Functional Tests' },
  { label: 'Position indication (open/closed)', section: 'Functional Tests' },
  { label: 'Auxiliary switch operation (if fitted)', section: 'Functional Tests' },
]

const IR_CLOSED = ['R-W', 'R-B', 'W-B', 'R-E', 'W-E', 'B-E', 'R-N', 'W-N', 'B-N']
const IR_OPEN = ['R-R', 'W-W', 'B-B', 'N-N']

function buildBreakerCard(asset: ChecklistAsset, brandHex: string, iceOverride: string | null = null): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const isAcb = asset.testKind === 'acb'
  const headerFill = tenantIce(brandHex, iceOverride)

  // ── Asset heading ──────────────────────────────────────────────────────────
  children.push(new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text: `Breaker: ${asset.assetName}`, size: 26, font: FONT_HEADING, bold: true, color: brandHex })],
  }))
  const infoParts: string[] = []
  if (asset.assetId && asset.assetId !== '—') infoParts.push(`ID: ${asset.assetId}`)
  if (asset.location && asset.location !== '—') infoParts.push(`Location: ${asset.location}`)
  if (infoParts.length > 0) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: infoParts.join('  |  '), size: 18, font: FONT, color: EQ_MID_GREY })],
    }))
  }

  // ── Section heading helper ─────────────────────────────────────────────────
  function sectionHeading(text: string) {
    return new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [new TextRun({ text, size: 20, font: FONT_HEADING, bold: true, color: brandHex })],
    })
  }

  // ── Section 1: Asset Collection ────────────────────────────────────────────
  children.push(sectionHeading('1  ·  Asset Collection'))

  const gLabel = 1800
  const gValue = 2400
  const gTw = (gLabel + gValue) * 2

  function gridRow(l1: string, l2: string): TableRow {
    return new TableRow({ children: [
      makeCell(l1, gLabel, { bold: true, size: 16, color: EQ_MID_GREY }),
      makeCell('', gValue, { size: 16 }),
      makeCell(l2, gLabel, { bold: true, size: 16, color: EQ_MID_GREY }),
      makeCell('', gValue, { size: 16 }),
    ]})
  }

  const collectionRows: TableRow[] = [
    gridRow('Brand', 'Breaker Type'),
    gridRow('Serial No', 'Poles'),
    gridRow('Trip Unit Model', 'Rating IN (A)'),
    gridRow('Fixed / Withdrawable', isAcb ? 'Performance Level' : 'Trip Unit Type'),
  ]

  if (isAcb) {
    collectionRows.push(new TableRow({ children: [
      makeCell('Protection Unit Fitted', gLabel, { bold: true, size: 16, color: EQ_MID_GREY }),
      makeCell('Y  /  N  (circle one)', gValue * 3 + gLabel, { size: 16 }),
    ]}))
  }

  children.push(new Table({
    width: { size: gTw, type: WidthType.DXA },
    columnWidths: [gLabel, gValue, gLabel, gValue],
    rows: collectionRows,
  }))

  // Protection settings sub-grid
  children.push(new Paragraph({
    spacing: { before: 100, after: 40 },
    children: [new TextRun({ text: 'Protection Settings', size: 16, font: FONT_HEADING, bold: true, color: EQ_MID_GREY })],
  }))

  const psRows: TableRow[] = [
    gridRow('Long Time Ir', 'Long Time Delay tr'),
    gridRow('Short Time Pickup Isd', 'Short Time Delay tsd'),
    gridRow('Instantaneous Pickup', 'Earth Fault Pickup'),
  ]
  if (isAcb) {
    psRows.push(gridRow('Earth Fault Delay', 'Earth Leakage Pickup'))
    psRows.push(gridRow('Earth Leakage Delay', ''))
  } else {
    psRows.push(gridRow('Earth Fault Delay', ''))
  }
  children.push(new Table({
    width: { size: gTw, type: WidthType.DXA },
    columnWidths: [gLabel, gValue, gLabel, gValue],
    rows: psRows,
  }))

  if (isAcb) {
    children.push(new Paragraph({
      spacing: { before: 100, after: 40 },
      children: [new TextRun({ text: 'Accessories', size: 16, font: FONT_HEADING, bold: true, color: EQ_MID_GREY })],
    }))
    children.push(new Table({
      width: { size: gTw, type: WidthType.DXA },
      columnWidths: [gLabel, gValue, gLabel, gValue],
      rows: [
        gridRow('Motor Charge', 'Shunt Trip MX1'),
        gridRow('Shunt Close XF', 'Undervoltage MN'),
        gridRow('2nd Shunt Trip MX2', ''),
      ],
    }))
  }

  // ── Section 2: Visual & Functional ────────────────────────────────────────
  children.push(sectionHeading('2  ·  Visual & Functional Inspection'))

  const vItems = isAcb ? ACB_VISUAL_ITEMS : NSX_VISUAL_ITEMS
  const vDesc = 5200
  const vOK   = 700
  const vFail = 900
  const vNA   = 700
  const vNote = CONTENT_WIDTH - vDesc - vOK - vFail - vNA
  const vTw   = vDesc + vOK + vFail + vNA + vNote

  let currentSection = ''
  const vRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('Item', vDesc, { bold: true, size: 16, shading: headerFill }),
        makeCell('OK', vOK,   { bold: true, size: 16, shading: headerFill }),
        makeCell('Fail', vFail, { bold: true, size: 16, shading: headerFill }),
        makeCell('N/A', vNA,  { bold: true, size: 16, shading: headerFill }),
        makeCell('Comment', vNote, { bold: true, size: 16, shading: headerFill }),
      ],
    }),
  ]

  for (const item of vItems) {
    if (item.section !== currentSection) {
      currentSection = item.section
      vRows.push(new TableRow({ children: [
        new TableCell({
          columnSpan: 5,
          width: { size: vTw, type: WidthType.DXA },
          shading: { fill: headerFill, type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({ children: [
            new TextRun({ text: item.section, size: 16, font: FONT_HEADING, bold: true, color: brandHex }),
          ]})],
        }),
      ]}))
    }
    vRows.push(new TableRow({ children: [
      makeCell(item.label, vDesc, { size: 16 }),
      makeCheckboxCell(vOK),
      makeCheckboxCell(vFail),
      makeCheckboxCell(vNA),
      makeCell('', vNote, { size: 16 }),
    ]}))
  }

  children.push(new Table({ width: { size: vTw, type: WidthType.DXA }, columnWidths: [vDesc, vOK, vFail, vNA, vNote], rows: vRows }))

  // ── Section 3: Electrical Test Readings ───────────────────────────────────
  children.push(sectionHeading('3  ·  Electrical Test Readings'))

  const eLabel = 2200
  const eVal   = Math.floor((CONTENT_WIDTH - eLabel) / 4)
  const eTw    = eLabel + eVal * 4

  function eHeaderRow(cols: string[]): TableRow {
    return new TableRow({
      tableHeader: true,
      children: [
        makeCell('', eLabel, { bold: true, size: 16, shading: headerFill }),
        ...cols.map(c => makeCell(c, eVal, { bold: true, size: 16, shading: headerFill })),
      ],
    })
  }
  function eDataRow(label: string, cols: string[]): TableRow {
    return new TableRow({ children: [
      makeCell(label, eLabel, { bold: true, size: 16, color: EQ_MID_GREY }),
      ...cols.map(c => makeCell(c, eVal, { size: 16 })),
    ]})
  }

  if (isAcb) {
    children.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'Contact Resistance (µΩ)', size: 16, font: FONT, bold: true })] }))
    children.push(new Table({
      width: { size: eTw, type: WidthType.DXA }, columnWidths: [eLabel, eVal, eVal, eVal, eVal],
      rows: [eHeaderRow(['Red', 'White', 'Blue', 'Neutral']), eDataRow('Resistance', ['', '', '', ''])],
    }))
  }

  // IR Closed (3 per row — 9 combos = 3 rows of 3)
  children.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'Insulation Resistance — Closed (MΩ)', size: 16, font: FONT, bold: true })] }))
  const irClosedCols = 3
  const irClosedW = Math.floor((CONTENT_WIDTH) / (irClosedCols * 2))
  const irClosedTw = irClosedCols * 2 * irClosedW
  const irClosedRows: TableRow[] = []
  for (let i = 0; i < IR_CLOSED.length; i += irClosedCols) {
    const chunk = IR_CLOSED.slice(i, i + irClosedCols)
    irClosedRows.push(new TableRow({ children: chunk.flatMap(combo => [
      makeCell(combo, irClosedW, { bold: true, size: 16, color: EQ_MID_GREY }),
      makeCell('', irClosedW, { size: 16 }),
    ])}))
  }
  children.push(new Table({ width: { size: irClosedTw, type: WidthType.DXA }, columnWidths: Array(irClosedCols * 2).fill(irClosedW), rows: irClosedRows }))

  // IR Open (4 combos in one row)
  children.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'Insulation Resistance — Open (MΩ)', size: 16, font: FONT, bold: true })] }))
  const irOpenW = Math.floor(CONTENT_WIDTH / (IR_OPEN.length * 2))
  const irOpenTw = irOpenW * IR_OPEN.length * 2
  children.push(new Table({
    width: { size: irOpenTw, type: WidthType.DXA },
    columnWidths: Array(IR_OPEN.length * 2).fill(irOpenW),
    rows: [new TableRow({ children: IR_OPEN.flatMap(combo => [
      makeCell(combo, irOpenW, { bold: true, size: 16, color: EQ_MID_GREY }),
      makeCell('', irOpenW, { size: 16 }),
    ])})],
  }))

  // Temperature (°C)
  children.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'Temperature (°C)', size: 16, font: FONT, bold: true })] }))
  const tempPhases = ['Red', 'White', 'Blue']
  const tempW = Math.floor(CONTENT_WIDTH / (tempPhases.length * 2))
  const tempTw = tempW * tempPhases.length * 2
  children.push(new Table({
    width: { size: tempTw, type: WidthType.DXA },
    columnWidths: Array(tempPhases.length * 2).fill(tempW),
    rows: [new TableRow({ children: tempPhases.flatMap(p => [
      makeCell(p, tempW, { bold: true, size: 16, color: EQ_MID_GREY }),
      makeCell('', tempW, { size: 16 }),
    ])})],
  }))

  // ── Overall result + notes ─────────────────────────────────────────────────
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Overall Result:  Pass  /  Fail  /  Defect  (circle one)', size: 18, font: FONT, bold: true })],
  }))
  children.push(new Paragraph({
    spacing: { before: 80, after: 40 },
    children: [new TextRun({ text: 'Notes / Follow-up:', size: 16, font: FONT, bold: true })],
  }))
  children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: ' ', size: 18 })] }))
  children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: ' ', size: 18 })] }))
  children.push(spacer(80))

  return children
}

// ─────────── Asset Checklist Section ───────────

function buildAssetSection(asset: ChecklistAsset, brandHex: string, iceOverride: string | null = null): (Paragraph | Table)[] {
  if (asset.testKind === 'acb' || asset.testKind === 'nsx') {
    return buildBreakerCard(asset, brandHex, iceOverride)
  }

  const children: (Paragraph | Table)[] = []
  const headerFill = tenantIce(brandHex, iceOverride)

  // Asset header — brand-coloured so each asset block reads as part of the
  // tenant-branded document, not a generic black-on-white form.
  children.push(new Paragraph({
    spacing: { before: 160, after: 120 },
    children: [new TextRun({
      text: `Asset: ${asset.assetName}`,
      size: 26,
      font: FONT_HEADING,
      bold: true,
      color: brandHex,
    })]
  }))

  // Asset info line
  const assetInfoParts: string[] = []
  if (asset.assetId) assetInfoParts.push(`ID: ${asset.assetId}`)
  if (asset.location) assetInfoParts.push(`Location: ${asset.location}`)
  if (asset.workOrderNumber) assetInfoParts.push(`WO: ${asset.workOrderNumber}`)

  if (assetInfoParts.length > 0) {
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({
        text: assetInfoParts.join('  |  '),
        size: 18,
        font: FONT,
      })]
    }))
  }

  // Task table
  const taskTableWidth = CONTENT_WIDTH
  const col1 = 500      // Task # (narrow)
  const col2 = 6000     // Task Description
  const col3 = 800      // Pass checkbox
  const col4 = 800      // Fail checkbox
  const col5 = 800      // NA checkbox
  const col6 = 3700     // Comments

  children.push(new Table({
    width: { size: taskTableWidth, type: WidthType.DXA },
    columnWidths: [col1, col2, col3, col4, col5, col6],
    rows: [
      // Header row — tinted with tenant ice + bold ink so the table header
      // reads as part of the tenant brand on otherwise B&W body.
      new TableRow({
        tableHeader: true,
        children: [
          makeCell('#', col1, { bold: true, size: 18, shading: headerFill }),
          makeCell('Task Description', col2, { bold: true, size: 18, shading: headerFill }),
          makeCell('✓ Pass', col3, { bold: true, size: 16, shading: headerFill }),
          makeCell('✗ Fail', col4, { bold: true, size: 16, shading: headerFill }),
          makeCell('N/A', col5, { bold: true, size: 16, shading: headerFill }),
          makeCell('Comments', col6, { bold: true, size: 18, shading: headerFill }),
        ],
      }),
      // Task rows
      ...asset.tasks.map(task =>
        new TableRow({
          children: [
            makeCell(String(task.order), col1, { size: 18 }),
            makeCell(task.description, col2, { size: 18 }),
            makeCheckboxCell(col3),
            makeCheckboxCell(col4),
            makeCheckboxCell(col5),
            makeCell('', col6, { size: 18 }),
          ],
        })
      ),
    ],
  }))

  children.push(spacer(120))

  // Asset notes space
  if (asset.notes || asset.tasks.length === 0) {
    children.push(new Paragraph({
      spacing: { before: 80 },
      children: [new TextRun({
        text: 'Asset Notes:',
        size: 18,
        font: FONT,
        bold: true,
      })]
    }))
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({
        text: asset.notes || '_________________________________________________________________',
        size: 18,
        font: FONT,
      })]
    }))
  }

  children.push(divider())

  return children
}

// ─────────── Simple Asset Register ───────────

function buildAssetRegister(assets: ChecklistAsset[], brandHex: string): (Paragraph | Table)[] {
  const _ = brandHex // brand colour reserved for future register-row tinting; keeps signature consistent with buildAssetSection.
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    spacing: { before: 160, after: 120 },
    children: [new TextRun({
      text: 'Asset Register',
      size: 28,
      font: FONT_HEADING,
      bold: true,
    })]
  }))

  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({
      text: `Total assets: ${assets.length}. Tick each asset when complete.`,
      size: 18,
      font: FONT,
    })]
  }))

  // Register table: # | Asset ID | Name | Location | WO # | Complete | Notes
  // Sum to CONTENT_WIDTH (15398 DXA) so the table fills the true A4
  // landscape page edge-to-edge. Notes column gets the largest share —
  // techs hand-write in there and it was tight before.
  const col1 = 500    // #
  const col2 = 1500   // Asset ID
  const col3 = 3800   // Name
  const col4 = 2800   // Location
  const col5 = 1700   // WO #
  const col6 = 900    // Complete checkbox
  const col7 = 4198   // Notes (15398 - sum of the others)

  children.push(new Table({
    width: { size: col1 + col2 + col3 + col4 + col5 + col6 + col7, type: WidthType.DXA },
    columnWidths: [col1, col2, col3, col4, col5, col6, col7],
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          makeCell('#', col1, { bold: true, size: 18 }),
          makeCell('Asset ID', col2, { bold: true, size: 18 }),
          makeCell('Name', col3, { bold: true, size: 18 }),
          makeCell('Location', col4, { bold: true, size: 18 }),
          makeCell('WO #', col5, { bold: true, size: 18 }),
          makeCell('Done', col6, { bold: true, size: 16 }),
          makeCell('Notes', col7, { bold: true, size: 18 }),
        ],
      }),
      ...assets.map((asset, idx) =>
        new TableRow({
          children: [
            makeCell(String(idx + 1), col1, { size: 18 }),
            makeCell(asset.assetId ?? '—', col2, { size: 18 }),
            makeCell(asset.assetName, col3, { size: 18 }),
            makeCell(asset.location ?? '—', col4, { size: 18 }),
            makeCell(asset.workOrderNumber ?? '', col5, { size: 18 }),
            makeCheckboxCell(col6),
            makeCell('', col7, { size: 18 }),
          ],
        })
      ),
    ],
  }))

  children.push(spacer(200))
  children.push(divider())

  return children
}

// ─────────── Sign-off Block ───────────

function buildSignOffBlock(): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  children.push(spacer(200))

  children.push(new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({
      text: 'Completed By',
      size: 20,
      font: FONT,
      bold: true,
    })]
  }))

  // Signature table: 3 columns
  const col1 = 3200
  const col2 = 3200
  const col3 = 3200
  const tw = col1 + col2 + col3

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [col1, col2, col3],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: BORDERS_NONE,
            width: { size: col1, type: WidthType.DXA },
            margins: CELL_PAD,
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: 'Name (Print)', size: 18, font: FONT, bold: true })]
              }),
              new Paragraph({
                spacing: { before: 200 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
                children: [new TextRun({ text: '', size: 18 })]
              })
            ]
          }),
          new TableCell({
            borders: BORDERS_NONE,
            width: { size: col2, type: WidthType.DXA },
            margins: CELL_PAD,
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: 'Date', size: 18, font: FONT, bold: true })]
              }),
              new Paragraph({
                spacing: { before: 200 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
                children: [new TextRun({ text: '', size: 18 })]
              })
            ]
          }),
          new TableCell({
            borders: BORDERS_NONE,
            width: { size: col3, type: WidthType.DXA },
            margins: CELL_PAD,
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [new TextRun({ text: 'Signature', size: 18, font: FONT, bold: true })]
              }),
              new Paragraph({
                spacing: { before: 200 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
                children: [new TextRun({ text: '', size: 18 })]
              })
            ]
          }),
        ],
      })
    ],
  }))

  return children
}

// ─────────── Main Generator ───────────

export async function generateMaintenanceChecklist(input: MaintenanceChecklistInput): Promise<Buffer> {
  // Sprint 2.3 (26-Apr-2026): use shared ReportShell for header/footer.
  // Local buildHeader/buildFooter functions below are kept as fallback in
  // case any external caller still imports them, but the document below
  // uses the shell variants directly.
  const shell = await prepareShell(
    resolveShellSettings({
      companyName: input.companyName ?? input.tenantProductName,
      productName: input.tenantProductName,
      primaryColour: input.primaryColour,
      headerText: `${input.checkName} — ${input.siteName}`,
      footerText: `${input.companyName || input.tenantProductName} — ${input.reportTypeLabel || 'Maintenance Checklist'} — rev 3.1`,
    }),
    {
      reportType: 'maintenance_check',
      reportDate: input.printedDate ?? new Date().toLocaleDateString('en-AU'),
      customerName: input.companyName ?? null,
      siteName: input.siteName,
      siteAddress: null,
      customerLogoUrl: null,
      sitePhotoUrl: null,
    },
  )

  // Build body: info block + all asset sections
  const bodyChildren: (Paragraph | Table)[] = []
  const brandHex = bareHex(input.primaryColour ?? '3DA8D8')
  const iceOverride = input.iceColour ?? null

  // Header info
  bodyChildren.push(...buildInfoBlock(input))

  // 2026-04-28: format semantics revised per Royce's "combine master +
  // detail" feedback.
  //
  //   simple   = master register only (one-page register, supervisor's
  //              hand-out / archive copy)
  //   standard = NEW DEFAULT — master register THEN per-asset detail
  //              cards. Supervisor keeps page 1 (the master), tech gets
  //              the rest (the detail cards). One print, two audiences.
  //   detailed = per-asset detail cards only (no master). Tech-only
  //              print for when the supervisor already has the master.
  //
  // Cover/header always sits on its own page now — page break BEFORE
  // any content so the first asset card never glues to the cover.
  const format = input.format ?? 'standard'

  if (format === 'simple') {
    // Master register only.
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(...buildAssetRegister(input.assets, brandHex))
  } else if (format === 'standard') {
    // Combined: master register THEN per-asset detail cards.
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(...buildAssetRegister(input.assets, brandHex))
    // 2026-04-28 (PR L — subtle branding): brand-coloured rule on its own
    // page break separates the supervisor's master from the tech's detail
    // cards. Visual handover, no extra wording.
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(buildBrandedRule(brandHex))
    for (let i = 0; i < input.assets.length; i++) {
      if (i > 0) bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
      bodyChildren.push(...buildAssetSection(input.assets[i], brandHex, iceOverride))
    }
  } else {
    // detailed = cards only, no master.
    for (let i = 0; i < input.assets.length; i++) {
      bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
      bodyChildren.push(...buildAssetSection(input.assets[i], brandHex, iceOverride))
    }
  }

  // Sign-off block at the end
  bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  bodyChildren.push(...buildSignOffBlock())

  // Create document with landscape orientation
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // Landscape: swap width and height
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: { default: buildShellHeader(shell) },
        // PR L: run-sheet specific footer with brand-coloured page numbers
        // + ABN (when supplied). Other reports keep the shared shell footer.
        footers: { default: buildBrandedRunSheetFooter(input, brandHex) },
        children: bodyChildren,
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
