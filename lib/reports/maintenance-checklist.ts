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
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  PageNumber,
  PageBreak,
  VerticalAlign,
} from 'docx'
import { buildMasthead } from '@/lib/reports/report-branding'

// ─────────── Types ───────────

export interface MaintenanceChecklistInput {
  // Tenant branding
  companyName: string
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
}

export interface ChecklistTask {
  order: number
  description: string
}

// ─────────── Constants ───────────

const PAGE_WIDTH = 13338   // A4 landscape DXA (~11.7")
const PAGE_HEIGHT = 11906  // A4 landscape DXA (~8.3")
const MARGIN = 720         // ~0.5 inch (12.7mm)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const FONT = 'Arial'
const FONT_HEADING = 'Arial'

const BORDER_STANDARD = { style: BorderStyle.SINGLE, size: 6, color: '000000' }
const BORDERS_STANDARD = { top: BORDER_STANDARD, bottom: BORDER_STANDARD, left: BORDER_STANDARD, right: BORDER_STANDARD }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as any
const BORDERS_NONE = { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE } as typeof BORDERS_STANDARD
const CELL_PAD = { top: 80, bottom: 80, left: 100, right: 100 }
const CELL_PAD_TIGHT = { top: 40, bottom: 40, left: 80, right: 80 }

// ─────────── Helpers ───────────

function makeCell(text: string, width: number, opts?: { bold?: boolean; color?: string; borders?: typeof BORDERS_STANDARD; size?: number }): TableCell {
  return new TableCell({
    borders: opts?.borders ?? BORDERS_STANDARD,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_PAD,
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

function divider(): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
  })
}

// ─────────── Header & Footer ───────────

function buildHeader(checkName: string, siteName: string): Header {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({
          text: `${checkName} — ${siteName}`,
          size: 20,
          font: FONT,
          bold: true,
        })]
      }),
    ]
  })
}

function buildFooter(tenantProductName: string, companyName?: string, reportTypeLabel?: string): Footer {
  const label = reportTypeLabel || 'Maintenance Checklist'
  const company = companyName || tenantProductName
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 0 },
        children: [
          new TextRun({
            text: `${company} — ${label} — rev 3.1`,
            size: 14,
            font: FONT,
            color: '666666'
          })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
        children: [
          new TextRun({
            text: 'Page ',
            size: 14,
            font: FONT,
            color: '666666'
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 14,
            font: FONT,
            color: '666666'
          })
        ]
      })
    ]
  })
}

// ─────────── Info Block ───────────

function buildInfoBlock(input: MaintenanceChecklistInput): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  // Masthead with logos (Phase 1 branding update)
  if (input.customerLogoImage || input.tenantLogoImage || input.reportTypeLabel) {
    children.push(
      buildMasthead({
        customerLogo: input.customerLogoImage ?? undefined,
        tenantLogo: input.tenantLogoImage ?? undefined,
        reportTypeLabel: input.reportTypeLabel || 'Maintenance Checklist',
      }),
    )
  }

  // Title
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({
      text: `${input.checkName}`,
      size: 32,
      font: FONT_HEADING,
      bold: true,
    })]
  }))

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({
      text: `${input.siteName}`,
      size: 24,
      font: FONT,
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

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: infoRows.map(([label, value]) =>
      new TableRow({
        children: [
          makeCell(label, c1, { bold: true, size: 18 }),
          makeCell(value, c2, { size: 18 }),
        ],
      })
    ),
  }))

  children.push(spacer(200))
  children.push(divider())

  return children
}

// ─────────── Asset Checklist Section ───────────

function buildAssetSection(asset: ChecklistAsset): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  // Asset header
  children.push(new Paragraph({
    spacing: { before: 160, after: 120 },
    children: [new TextRun({
      text: `Asset: ${asset.assetName}`,
      size: 26,
      font: FONT_HEADING,
      bold: true,
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
      // Header row
      new TableRow({
        children: [
          makeCell('#', col1, { bold: true, size: 18 }),
          makeCell('Task Description', col2, { bold: true, size: 18 }),
          makeCell('✓ Pass', col3, { bold: true, size: 16 }),
          makeCell('✗ Fail', col4, { bold: true, size: 16 }),
          makeCell('N/A', col5, { bold: true, size: 16 }),
          makeCell('Comments', col6, { bold: true, size: 18 }),
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

function buildAssetRegister(assets: ChecklistAsset[]): (Paragraph | Table)[] {
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
  const col1 = 500   // #
  const col2 = 1400  // ID
  const col3 = 3200  // Name
  const col4 = 2400  // Location
  const col5 = 1600  // WO #
  const col6 = 900   // Complete checkbox
  const col7 = 3300  // Notes

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
  // Build body: info block + all asset sections
  const bodyChildren: (Paragraph | Table)[] = []

  // Header info
  bodyChildren.push(...buildInfoBlock(input))

  const format = input.format ?? 'detailed'

  if (format === 'simple') {
    // Simple: single asset register table only
    bodyChildren.push(...buildAssetRegister(input.assets))
  } else {
    // Detailed: per-asset task breakdown with page breaks
    for (let i = 0; i < input.assets.length; i++) {
      if (i > 0) {
        bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
      }
      bodyChildren.push(...buildAssetSection(input.assets[i]))
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
        headers: {
          default: buildHeader(input.checkName, input.siteName),
        },
        footers: {
          default: buildFooter(input.tenantProductName, input.companyName, input.reportTypeLabel),
        },
        children: bodyChildren,
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
