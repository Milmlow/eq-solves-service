/**
 * PM Asset Report — DOCX Generator
 *
 * Professional preventive maintenance report per site with:
 * - Cover page with site info + photo
 * - Site overview section
 * - Table of contents with internal links
 * - Executive summary with KPI stats
 * - Per-asset report sections (page break between each)
 * - Maintenance checklist tables per asset
 * - Final sign-off page
 * - White-label branding
 *
 * Inspired by the Equinix/SKS PM Asset Report format.
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
  VerticalAlign,
  Bookmark,
  InternalHyperlink,
  ImageRun,
  TabStopType,
  TabStopPosition,
} from 'docx'

// ─────────── Types ───────────

export interface PmAssetReportInput {
  // Complexity level
  complexity?: 'summary' | 'standard' | 'detailed'

  // Report metadata
  reportTitle: string               // e.g. "SY2 - Annual - 04/2026 - April PM"
  reportGeneratedDate: string       // ISO date
  reportingPeriod: string           // e.g. "April 2026" or "Q1 2026"

  // Site info
  siteName: string
  siteCode: string
  siteAddress: string
  customerName: string
  supervisorName: string
  contactEmail: string
  contactPhone: string

  // Check info
  startDate: string
  dueDate: string
  completedDate: string | null
  outstandingAssets: number
  outstandingWorkOrders: number

  // Technician / prepared by
  technicianName: string
  reviewerName: string | null

  // Branding
  tenantProductName: string
  primaryColour: string             // hex e.g. "#1B4F72" or "1B4F72"

  // Site photo (optional)
  sitePhoto?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  /**
   * Tenant/report logo variants. Cover page (dark surface) prefers `onDark`;
   * running header/body (light surface) prefers `onLight`. Either can fall
   * back to the other — see {@link pickLogo}.
   *
   * @deprecated — pass `logoImageOnLight` / `logoImageOnDark` explicitly.
   *              Kept as an alias so old call sites still compile.
   */
  logoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  /** Customer logo variants (rendered on cover when toggle is on). */
  customerLogoOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  customerLogoOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  // Company details (from report settings)
  companyName?: string
  companyAddress?: string
  companyAbn?: string
  companyPhone?: string

  // Assets
  assets: PmAssetSection[]

  // Overall notes
  overallNotes?: string

  // Report template config
  showCoverPage?: boolean        // default true
  showSiteOverview?: boolean     // default true
  showContents?: boolean         // default true
  showExecutiveSummary?: boolean // default true
  showSignOff?: boolean          // default true
  customHeaderText?: string      // overrides default header
  customFooterText?: string      // overrides default footer
  signOffFields?: string[]       // default ['Technician Signature', 'Supervisor Signature']
}

export interface PmAssetSection {
  assetName: string
  assetId: string                   // Maximo ID
  site: string
  location: string
  jobPlanName: string               // e.g. "M14.5 - Load banks"
  workOrderNumber?: string | null   // Maximo work order #, if captured via Delta import
  tasks: PmAssetTask[]
  defectsFound?: string
  recommendedAction?: string
  technicianName: string
  completedDate: string | null
  notes?: string
  photos?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }[]
}

export interface PmAssetTask {
  order: number
  description: string
  result: 'pass' | 'fail' | 'na' | 'yes' | 'no' | 'requires_followup' | null
  notes?: string
}

// ─────────── Constants ───────────

const PAGE_WIDTH = 11906  // A4 DXA
const PAGE_HEIGHT = 16838
const MARGIN = 1134       // ~0.79 inch (20mm)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2  // ~9638

const FONT = 'Arial'
const FONT_HEADING = 'Arial'

const BORDER_LIGHT = { style: BorderStyle.SINGLE, size: 1, color: 'D5D8DC' }
const BORDERS_LIGHT = { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as any
const BORDERS_NONE = { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE } as typeof BORDERS_LIGHT
const CELL_PAD = { top: 60, bottom: 60, left: 100, right: 100 }
const CELL_PAD_TIGHT = { top: 40, bottom: 40, left: 80, right: 80 }

// ─────────── Helpers ───────────

function getBrand(input: PmAssetReportInput): string {
  return input.primaryColour.replace('#', '')
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    return `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`
  } catch {
    return dateStr
  }
}

function resultText(r: PmAssetTask['result']): string {
  switch (r) {
    case 'pass': case 'yes': return 'Yes'
    case 'fail': case 'no': return 'No'
    case 'na': return 'N/A'
    case 'requires_followup': return 'Follow-up'
    default: return '—'
  }
}

function resultShading(r: PmAssetTask['result']): string | undefined {
  switch (r) {
    case 'pass': case 'yes': return 'E8F5E9'
    case 'fail': case 'no': return 'FFEBEE'
    case 'requires_followup': return 'FFF8E1'
    default: return undefined
  }
}

function anchorId(assetName: string, assetId: string): string {
  return `asset_${assetId}_${assetName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}`
}

/**
 * Pick the appropriate tenant/report logo image for a given surface.
 *
 * - `light` surface (white cover, running header, body) prefers `logoImageOnLight`
 * - `dark` surface (dark cover variant, ink banners) prefers `logoImageOnDark`
 *
 * Falls back through:
 *   requested variant → other variant → legacy `logoImage` alias
 *
 * Guarantees something renders as long as *any* logo was supplied.
 */
function pickReportLogo(
  input: PmAssetReportInput,
  surface: 'light' | 'dark',
): { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | undefined {
  if (surface === 'dark') {
    return input.logoImageOnDark ?? input.logoImageOnLight ?? input.logoImage
  }
  return input.logoImageOnLight ?? input.logoImage ?? input.logoImageOnDark
}

/**
 * Pick customer logo for the cover page. Rendered when either variant is
 * provided by the caller — the picker falls back between variants.
 */
function pickCustomerLogo(
  input: PmAssetReportInput,
  surface: 'light' | 'dark',
): { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | undefined {
  if (surface === 'dark') {
    return input.customerLogoOnDark ?? input.customerLogoOnLight
  }
  return input.customerLogoOnLight ?? input.customerLogoOnDark
}

function makeCell(text: string, width: number, opts?: {
  bold?: boolean; size?: number; color?: string; shading?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  borders?: typeof BORDERS_LIGHT; font?: string; italics?: boolean
}): TableCell {
  return new TableCell({
    borders: opts?.borders ?? BORDERS_LIGHT,
    width: { size: width, type: WidthType.DXA },
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: CELL_PAD,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: opts?.align,
      children: [new TextRun({
        text: text || '—',
        bold: opts?.bold,
        size: opts?.size ?? 18,
        font: opts?.font ?? FONT,
        color: opts?.color,
        italics: opts?.italics,
      })]
    })],
  })
}

function makeHeaderCell(text: string, width: number, brand: string): TableCell {
  return new TableCell({
    borders: BORDERS_LIGHT,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: brand, type: ShadingType.CLEAR },
    margins: CELL_PAD,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 18, font: FONT, color: 'FFFFFF' })]
    })],
  })
}

function spacer(pts = 200): Paragraph {
  return new Paragraph({ spacing: { before: pts } })
}

function divider(brand: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: brand, space: 1 } },
  })
}

// ─────────── Section Builders ───────────

function buildCoverPage(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  // Logo — cover page is currently a light surface in this template, but the
  // picker is future-proof: if a "dark cover" variant is introduced later
  // we'll just flip the surface argument here.
  const coverLogo = pickReportLogo(input, 'light')
  if (coverLogo) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [new ImageRun({
        type: coverLogo.type,
        data: coverLogo.data,
        transformation: { width: coverLogo.width, height: coverLogo.height },
        altText: { title: 'Company Logo', description: 'Company logo', name: 'company-logo' },
      })],
    }))
  }

  // Top accent bar
  children.push(new Paragraph({
    spacing: { after: 600 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: brand, space: 1 } },
  }))

  // Spacer
  children.push(spacer(coverLogo ? 400 : 1200))

  // Report title
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
    children: [new TextRun({
      text: input.reportTitle,
      bold: true, size: 48, font: FONT_HEADING, color: '2C3E50',
    })],
  }))

  // Subtitle
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({
      text: 'Preventive Maintenance Asset Report',
      size: 28, font: FONT, color: '7F8C8D', italics: true,
    })],
  }))

  // Generated date
  children.push(new Paragraph({
    spacing: { after: 600 },
    children: [new TextRun({
      text: `Report Generated: ${fmtDate(input.reportGeneratedDate)}`,
      size: 20, font: FONT, color: '95A5A6',
    })],
  }))

  // Customer logo — "Prepared for" lockup
  const customerLogo = pickCustomerLogo(input, 'light')
  if (customerLogo) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({
        text: 'Prepared for',
        size: 18, font: FONT, color: '95A5A6',
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 400 },
      children: [new ImageRun({
        type: customerLogo.type,
        data: customerLogo.data,
        transformation: { width: customerLogo.width, height: customerLogo.height },
        altText: { title: 'Customer Logo', description: `Logo for ${input.customerName}`, name: 'customer-logo' },
      })],
    }))
  }

  // Site photo
  if (input.sitePhoto) {
    children.push(new Paragraph({
      spacing: { after: 400 },
      children: [new ImageRun({
        type: input.sitePhoto.type,
        data: input.sitePhoto.data,
        transformation: { width: input.sitePhoto.width, height: input.sitePhoto.height },
        altText: { title: 'Site Photo', description: `Photo of ${input.siteName}`, name: 'site-photo' },
      })],
    }))
  }

  // Info grid
  const c1 = 2400
  const c2 = 7238
  const tw = c1 + c2

  const infoRows: [string, string][] = [
    ['Site', input.siteName],
    ['Customer', input.customerName],
    ['Reporting Period', input.reportingPeriod],
    ['Prepared By', input.technicianName],
    ['Supervisor', input.supervisorName],
  ]
  if (input.companyName) infoRows.push(['Company', input.companyName])
  if (input.companyAbn) infoRows.push(['ABN', input.companyAbn])

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: infoRows.map(([label, value]) =>
      new TableRow({
        children: [
          makeCell(label, c1, { bold: true, color: '566573', borders: BORDERS_NONE, size: 20 }),
          makeCell(value, c2, { borders: BORDERS_NONE, size: 20 }),
        ],
      })
    ),
  }))

  // Footer branding
  children.push(spacer(1600))
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 3, color: brand, space: 1 } },
    spacing: { before: 200 },
    children: [new TextRun({
      text: input.tenantProductName,
      size: 18, font: FONT, color: '95A5A6',
    })],
  }))

  return children
}

function buildSiteOverview(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'site_overview',
      children: [new TextRun({ text: 'Site Overview', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  const c1 = 3200
  const c2 = 6438
  const tw = c1 + c2

  const rows = [
    ['Site Name / Code', `${input.siteName} (${input.siteCode})`],
    ['Address', input.siteAddress],
    ['Customer', input.customerName],
    ['Supervisor', input.supervisorName],
    ['Contact Email', input.contactEmail],
    ['Phone', input.contactPhone],
    ['Start Date', fmtDate(input.startDate)],
    ['Due Date', fmtDate(input.dueDate)],
    ['Completed Date', fmtDate(input.completedDate)],
    ['Outstanding Assets', String(input.outstandingAssets)],
    ['Outstanding Work Orders', String(input.outstandingWorkOrders)],
  ]

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: rows.map(([label, value], i) =>
      new TableRow({
        children: [
          makeCell(label, c1, { bold: true, shading: i % 2 === 0 ? 'F8F9FA' : undefined }),
          makeCell(value, c2, { shading: i % 2 === 0 ? 'F8F9FA' : undefined }),
        ],
      })
    ),
  }))

  return children
}

function buildContentsPage(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'contents',
      children: [new TextRun({ text: 'Contents', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  // Fixed sections
  const fixedSections = ['Site Overview', 'Executive Summary']
  for (const section of fixedSections) {
    const anchor = section.toLowerCase().replace(/\s+/g, '_')
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new InternalHyperlink({
        anchor,
        children: [new TextRun({ text: section, style: 'Hyperlink', size: 20, font: FONT })],
      })],
    }))
  }

  // Spacer before asset list
  children.push(spacer(120))
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Asset Reports', bold: true, size: 22, font: FONT, color: '2C3E50' })],
  }))

  // Asset entries
  for (const asset of input.assets) {
    const anchor = anchorId(asset.assetName, asset.assetId)
    children.push(new Paragraph({
      spacing: { before: 40, after: 40 },
      indent: { left: 360 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new InternalHyperlink({
          anchor,
          children: [new TextRun({
            text: `${asset.assetName} — ${asset.assetId}`,
            style: 'Hyperlink', size: 20, font: FONT,
          })],
        }),
        new TextRun({ text: `\t${asset.jobPlanName}`, size: 18, font: FONT, color: '95A5A6' }),
      ],
    }))
  }

  // Sign-off link
  children.push(spacer(120))
  children.push(new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new InternalHyperlink({
      anchor: 'sign_off',
      children: [new TextRun({ text: 'Sign-off & Approval', style: 'Hyperlink', size: 20, font: FONT })],
    })],
  }))

  return children
}

function buildExecutiveSummary(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'executive_summary',
      children: [new TextRun({ text: 'Executive Summary', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  // Calculate stats
  const totalAssets = input.assets.length
  let totalTasks = 0
  let passedTasks = 0
  let failedTasks = 0
  let naTasks = 0
  let followUpTasks = 0
  let assetsWithIssues = 0

  for (const asset of input.assets) {
    let assetHasIssue = false
    for (const task of asset.tasks) {
      totalTasks++
      if (task.result === 'pass' || task.result === 'yes') passedTasks++
      else if (task.result === 'fail' || task.result === 'no') { failedTasks++; assetHasIssue = true }
      else if (task.result === 'na') naTasks++
      else if (task.result === 'requires_followup') { followUpTasks++; assetHasIssue = true }
    }
    if (assetHasIssue || asset.defectsFound) assetsWithIssues++
  }

  const assetsPassed = totalAssets - assetsWithIssues
  const passRate = totalTasks > 0 ? Math.round((passedTasks / (totalTasks - naTasks)) * 100) : 0

  // KPI grid — 2x3 table
  const kpiWidth = Math.floor(CONTENT_WIDTH / 3)
  const kpiRemainder = CONTENT_WIDTH - kpiWidth * 3

  function kpiCell(label: string, value: string, color: string, width: number): TableCell {
    return new TableCell({
      borders: BORDERS_LIGHT,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: 'F8F9FA', type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: value, bold: true, size: 36, font: FONT_HEADING, color })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: label, size: 16, font: FONT, color: '7F8C8D' })],
        }),
      ],
    })
  }

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [kpiWidth, kpiWidth, kpiWidth + kpiRemainder],
    rows: [
      new TableRow({
        children: [
          kpiCell('Total Assets', String(totalAssets), '2C3E50', kpiWidth),
          kpiCell('Assets Passed', String(assetsPassed), '27AE60', kpiWidth),
          kpiCell('Assets with Issues', String(assetsWithIssues), assetsWithIssues > 0 ? 'E74C3C' : '27AE60', kpiWidth + kpiRemainder),
        ],
      }),
      new TableRow({
        children: [
          kpiCell('Total Tasks', String(totalTasks), '2C3E50', kpiWidth),
          kpiCell('Pass Rate', `${passRate}%`, passRate >= 80 ? '27AE60' : passRate >= 50 ? 'F39C12' : 'E74C3C', kpiWidth),
          kpiCell('Outstanding Actions', String(failedTasks + followUpTasks), failedTasks + followUpTasks > 0 ? 'E74C3C' : '27AE60', kpiWidth + kpiRemainder),
        ],
      }),
    ],
  }))

  // Breakdown table
  children.push(spacer(200))
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Task Breakdown', bold: true, size: 22, font: FONT, color: '2C3E50' })],
  }))

  const bc1 = 4000
  const bc2 = 2000
  const btw = bc1 + bc2

  const breakdownRows = [
    ['Passed / Yes', String(passedTasks), 'E8F5E9'],
    ['Failed / No', String(failedTasks), failedTasks > 0 ? 'FFEBEE' : undefined],
    ['N/A', String(naTasks), undefined],
    ['Requires Follow-up', String(followUpTasks), followUpTasks > 0 ? 'FFF8E1' : undefined],
  ]

  children.push(new Table({
    width: { size: btw, type: WidthType.DXA },
    columnWidths: [bc1, bc2],
    rows: [
      new TableRow({
        children: [
          makeHeaderCell('Category', bc1, brand),
          makeHeaderCell('Count', bc2, brand),
        ],
      }),
      ...breakdownRows.map(([label, value, shading]) =>
        new TableRow({
          children: [
            makeCell(label!, bc1, { bold: true, shading: shading as string | undefined }),
            makeCell(value!, bc2, { align: AlignmentType.CENTER, shading: shading as string | undefined }),
          ],
        })
      ),
    ],
  }))

  // Overall notes
  if (input.overallNotes) {
    children.push(spacer(200))
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Key Findings & Notes', bold: true, size: 22, font: FONT, color: '2C3E50' })],
    }))
    children.push(new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: input.overallNotes, size: 20, font: FONT, color: '34495E' })],
    }))
  }

  return children
}

function buildAssetSection(asset: PmAssetSection, brand: string, complexity: 'summary' | 'standard' | 'detailed' = 'standard'): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const anchor = anchorId(asset.assetName, asset.assetId)

  // Asset heading with bookmark
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new Bookmark({
      id: anchor,
      children: [new TextRun({
        text: `${asset.assetName} — ${asset.assetId}`,
        bold: true, size: 26, font: FONT_HEADING, color: brand,
      })],
    })],
  }))

  children.push(divider(brand))

  // Asset info grid (2 columns)
  const c1 = 2000
  const c2 = 2819
  const c3 = 2000
  const c4 = 2819
  const tw = c1 + c2 + c3 + c4

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          makeCell('Site', c1, { bold: true, shading: 'F8F9FA', size: 18 }),
          makeCell(asset.site, c2, { size: 18 }),
          makeCell('Asset', c3, { bold: true, shading: 'F8F9FA', size: 18 }),
          makeCell(asset.assetName, c4, { size: 18 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('Location', c1, { bold: true, shading: 'F8F9FA', size: 18 }),
          makeCell(asset.location, c2, { size: 18 }),
          makeCell('Maximo ID', c3, { bold: true, shading: 'F8F9FA', size: 18 }),
          makeCell(asset.assetId, c4, { size: 18 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('Work Order #', c1, { bold: true, shading: 'F8F9FA', size: 18 }),
          makeCell(asset.workOrderNumber ?? '—', c2, { size: 18 }),
          makeCell('Job Plan', c3, { bold: true, shading: 'F8F9FA', size: 18 }),
          makeCell(asset.jobPlanName, c4, { size: 18 }),
        ],
      }),
    ],
  }))

  if (complexity === 'summary') {
    // Summary: just show pass/fail counts instead of full checklist
    const passed = asset.tasks.filter(t => t.result === 'pass' || t.result === 'yes').length
    const failed = asset.tasks.filter(t => t.result === 'fail' || t.result === 'no').length
    const na = asset.tasks.filter(t => t.result === 'na').length
    const pending = asset.tasks.length - passed - failed - na

    children.push(spacer(120))
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: `${asset.tasks.length} tasks: `, size: 20, font: FONT, color: '2C3E50' }),
        new TextRun({ text: `${passed} pass`, bold: true, size: 20, font: FONT, color: '27AE60' }),
        new TextRun({ text: ' · ', size: 20, font: FONT, color: '95A5A6' }),
        new TextRun({ text: `${failed} fail`, bold: true, size: 20, font: FONT, color: failed > 0 ? 'C0392B' : '95A5A6' }),
        ...(pending > 0 ? [
          new TextRun({ text: ' · ', size: 20, font: FONT, color: '95A5A6' }),
          new TextRun({ text: `${pending} pending`, size: 20, font: FONT, color: 'F39C12' }),
        ] : []),
        ...(na > 0 ? [
          new TextRun({ text: ' · ', size: 20, font: FONT, color: '95A5A6' }),
          new TextRun({ text: `${na} N/A`, size: 20, font: FONT, color: '95A5A6' }),
        ] : []),
      ],
    }))

    // Still show defects in summary
    if (asset.defectsFound) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        border: { left: { style: BorderStyle.SINGLE, size: 8, color: 'E74C3C', space: 8 } },
        indent: { left: 200 },
        children: [new TextRun({ text: asset.defectsFound, size: 18, font: FONT, color: 'C0392B' })],
      }))
    }
  } else {
    // Standard + Detailed: full task checklist
    children.push(spacer(200))
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Maintenance Checklist', bold: true, size: 22, font: FONT, color: '2C3E50' })],
    }))

    // Column widths differ by complexity — Detailed gives more room to Notes
    // so longer inspection commentary reads naturally instead of wrapping.
    const tc1 = 700                                      // Order
    const tc3 = 1400                                     // Result
    const tc4 = complexity === 'detailed' ? 3600 : 2800  // Notes
    const tc2 = CONTENT_WIDTH - tc1 - tc3 - tc4          // Description (fills remainder)
    const ttw = tc1 + tc2 + tc3 + tc4

    const taskRows = asset.tasks.map(task => {
      const noteText = task.notes?.trim()
      const hasNote = !!noteText
      // Detailed shows the raw note; Standard trims very long notes to keep
      // the table readable on a single page.
      const displayNote = hasNote
        ? (complexity === 'detailed' || noteText!.length <= 200
            ? noteText!
            : noteText!.slice(0, 200).trimEnd() + '…')
        : '—'

      return new TableRow({
        children: [
          makeCell(String(task.order), tc1, { align: AlignmentType.CENTER, size: 18 }),
          makeCell(task.description, tc2, { size: 18 }),
          makeCell(resultText(task.result), tc3, {
            align: AlignmentType.CENTER,
            bold: true,
            size: 18,
            shading: resultShading(task.result),
            color: task.result === 'fail' || task.result === 'no' ? 'C0392B' : undefined,
          }),
          makeCell(displayNote, tc4, {
            size: 17,
            color: hasNote ? '34495E' : '95A5A6',
            italics: !hasNote,
          }),
        ],
      })
    })

    children.push(new Table({
      width: { size: ttw, type: WidthType.DXA },
      columnWidths: [tc1, tc2, tc3, tc4],
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            makeHeaderCell('Order', tc1, brand),
            makeHeaderCell('Description', tc2, brand),
            makeHeaderCell('Completed', tc3, brand),
            makeHeaderCell('Notes', tc4, brand),
          ],
        }),
        ...taskRows,
      ],
    }))

    // Defects / issues — always rendered so the reader can see at a glance
    // that a section was reviewed and nothing was flagged.
    const defectText = asset.defectsFound?.trim() || 'None identified.'
    const hasDefect = !!asset.defectsFound?.trim()
    children.push(spacer(160))
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: 'Defects / Issues Found',
        bold: true, size: 20, font: FONT,
        color: hasDefect ? 'C0392B' : '2C3E50',
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 80 },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 8,
          color: hasDefect ? 'E74C3C' : 'BDC3C7',
          space: 8,
        },
      },
      indent: { left: 200 },
      children: [new TextRun({
        text: defectText,
        size: 18, font: FONT,
        color: hasDefect ? '34495E' : '7F8C8D',
        italics: !hasDefect,
      })],
    }))

    // Recommended action — always rendered, same pattern as defects
    const actionText = asset.recommendedAction?.trim() || 'No follow-up action required.'
    const hasAction = !!asset.recommendedAction?.trim()
    children.push(spacer(100))
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: 'Recommended Action',
        bold: true, size: 20, font: FONT,
        color: hasAction ? brand : '2C3E50',
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 80 },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 8,
          color: hasAction ? brand : 'BDC3C7',
          space: 8,
        },
      },
      indent: { left: 200 },
      children: [new TextRun({
        text: actionText,
        size: 18, font: FONT,
        color: hasAction ? '34495E' : '7F8C8D',
        italics: !hasAction,
      })],
    }))

    // Detailed-only: asset-level notes block (the overall `asset.notes` field)
    if (complexity === 'detailed' && asset.notes?.trim()) {
      children.push(spacer(120))
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: 'Technician Notes', bold: true, size: 20, font: FONT, color: '2C3E50' })],
      }))
      children.push(new Paragraph({
        spacing: { after: 80 },
        border: { left: { style: BorderStyle.SINGLE, size: 8, color: 'BDC3C7', space: 8 } },
        indent: { left: 200 },
        children: [new TextRun({ text: asset.notes, size: 18, font: FONT, color: '34495E' })],
      }))
    }

    // Asset photos (detailed only)
    if (complexity === 'detailed' && asset.photos && asset.photos.length > 0) {
      children.push(spacer(160))
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: 'Asset Photos', bold: true, size: 20, font: FONT, color: '2C3E50' })],
      }))
      for (const photo of asset.photos) {
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [new ImageRun({
            type: photo.type,
            data: photo.data,
            transformation: { width: photo.width, height: photo.height },
            altText: { title: `${asset.assetName} photo`, description: `Photo of ${asset.assetName}`, name: `photo-${asset.assetId}` },
          })],
        }))
      }
    }
  }

  // Confirmation statement
  children.push(spacer(200))
  children.push(new Paragraph({
    spacing: { after: 40 },
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'D5D8DC', space: 4 } },
    children: [new TextRun({
      text: 'I confirm that the above work has been carried out successfully as required.',
      italics: true, size: 18, font: FONT, color: '566573',
    })],
  }))

  // Name and date row
  const sc1 = 4819
  const sc2 = 4819
  const stw = sc1 + sc2

  children.push(new Table({
    width: { size: stw, type: WidthType.DXA },
    columnWidths: [sc1, sc2],
    rows: [
      new TableRow({
        children: [
          makeCell(`Name: ${asset.technicianName}`, sc1, { borders: BORDERS_NONE, size: 18 }),
          makeCell(`Date: ${fmtDate(asset.completedDate)}`, sc2, { borders: BORDERS_NONE, size: 18, align: AlignmentType.RIGHT }),
        ],
      }),
    ],
  }))

  return children
}

function buildSignOff(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'sign_off',
      children: [new TextRun({ text: 'Sign-off & Approval', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({
      text: 'This report documents the preventive maintenance activities completed for the assets listed above. All work was carried out in accordance with applicable maintenance procedures and safety requirements.',
      size: 20, font: FONT, color: '34495E',
    })],
  }))

  // Sign-off table
  const sc1 = 3200
  const sc2 = 6438
  const stw = sc1 + sc2

  const signRows = [
    ['Technician', input.technicianName],
    ['Supervisor / Reviewer', input.reviewerName ?? ''],
    ['Completion Date', fmtDate(input.completedDate)],
    ['Approval Status', input.completedDate ? 'Complete' : 'Pending'],
  ]

  children.push(new Table({
    width: { size: stw, type: WidthType.DXA },
    columnWidths: [sc1, sc2],
    rows: signRows.map(([label, value]) =>
      new TableRow({
        height: { value: 600, rule: 'atLeast' as never },
        children: [
          makeCell(label, sc1, { bold: true, shading: 'F8F9FA' }),
          makeCell(value, sc2),
        ],
      })
    ),
  }))

  // Signature lines (dynamic from settings)
  children.push(spacer(600))

  const fields = input.signOffFields?.length ? input.signOffFields : ['Technician Signature', 'Supervisor Signature']
  // Pair fields into rows of 2
  for (let i = 0; i < fields.length; i += 2) {
    const pair = fields.slice(i, i + 2)
    const sigColW = Math.floor(CONTENT_WIDTH / 2)

    children.push(new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: pair.length === 2 ? [sigColW, CONTENT_WIDTH - sigColW] : [CONTENT_WIDTH],
      rows: [
        new TableRow({
          height: { value: 1200, rule: 'atLeast' as never },
          children: pair.map((label, idx) =>
            new TableCell({
              borders: BORDERS_NONE,
              width: { size: pair.length === 2 ? (idx === 0 ? sigColW : CONTENT_WIDTH - sigColW) : CONTENT_WIDTH, type: WidthType.DXA },
              margins: CELL_PAD,
              children: [
                spacer(400),
                new Paragraph({
                  border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '2C3E50', space: 1 } },
                  children: [],
                }),
                new Paragraph({
                  spacing: { before: 40 },
                  children: [new TextRun({ text: label, size: 16, font: FONT, color: '95A5A6' })],
                }),
              ],
            })
          ),
        }),
      ],
    }))
  }

  return children
}

// ─────────── Main Export ───────────

export async function generatePMAssetReport(input: PmAssetReportInput): Promise<Buffer> {
  const brand = getBrand(input)

  const complexity = input.complexity ?? 'standard'

  // Resolve section toggles (default all true)
  const showCover = input.showCoverPage !== false
  const showOverview = input.showSiteOverview !== false
  // Summary skips TOC and executive summary unless explicitly enabled
  const showContents = complexity === 'summary' ? false : input.showContents !== false
  const showSummary = input.showExecutiveSummary !== false
  const showSignOff = input.showSignOff !== false

  // Custom header / footer text
  const headerText = input.customHeaderText || input.reportTitle
  const footerText = input.customFooterText || input.tenantProductName

  // Build all per-asset sections with page breaks
  const assetSectionChildren: (Paragraph | Table)[] = []
  for (let i = 0; i < input.assets.length; i++) {
    if (i > 0) {
      assetSectionChildren.push(new Paragraph({ children: [new PageBreak()] }))
    }
    assetSectionChildren.push(...buildAssetSection(input.assets[i], brand, complexity))
  }

  // Build body content (conditionally include sections)
  const bodyChildren: (Paragraph | Table)[] = []

  if (showOverview) {
    bodyChildren.push(...buildSiteOverview(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (showContents) {
    bodyChildren.push(...buildContentsPage(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (showSummary) {
    bodyChildren.push(...buildExecutiveSummary(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }

  bodyChildren.push(...assetSectionChildren)

  if (showSignOff) {
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(...buildSignOff(input))
  }

  const sections = []

  // Cover page section (separate — no header/footer)
  if (showCover) {
    sections.push({
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: buildCoverPage(input),
    })
  }

  // Body section with header/footer
  sections.push({
    properties: {
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: headerText, size: 16, font: FONT, color: '95A5A6' }),
          ],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: `${footerText}  |  Page `, size: 14, font: FONT, color: '95A5A6' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 14, font: FONT, color: '95A5A6' }),
          ],
        })],
      }),
    },
    children: bodyChildren,
  })

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: FONT_HEADING, color: brand },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: FONT_HEADING, color: brand },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    sections,
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
