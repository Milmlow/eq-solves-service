/**
 * Compliance Dashboard Report — DOCX Generator
 *
 * Produces a compliance/dashboard report with:
 * - Cover page with scope and branding
 * - Maintenance compliance KPIs
 * - Maintenance breakdown by status
 * - Test results summary
 * - ACB/NSX workflow progress
 * - Defects register summary
 * - Compliance by site table
 * - 6-month trend summary
 *
 * Designed for monthly meetings — filterable by customer, site, and date range.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  PageBreak,
  VerticalAlign,
} from 'docx'
import {
  buildHeader as buildShellHeader,
  buildFooter as buildShellFooter,
  prepareShell,
  resolveShellSettings,
  type ShellSettings,
} from './report-shell'

// ---------- types ----------

export interface ComplianceReportInput {
  filterDescription: string
  generatedDate: string
  tenantProductName: string
  primaryColour: string // hex without #
  complexity: 'summary' | 'standard' | 'detailed'

  // Maintenance
  maintenance: {
    total: number
    complete: number
    inProgress: number
    scheduled: number
    overdue: number
    cancelled: number
    complianceRate: number
  }

  // Testing
  testing: {
    total: number
    pass: number
    fail: number
    defect: number
    pending: number
    passRate: number
  }

  // ACB progress
  acb: { total: number; complete: number; inProgress: number; notStarted: number }

  // NSX progress
  nsx: { total: number; complete: number; inProgress: number; notStarted: number }

  // Defects
  defects: {
    total: number
    open: number
    inProgress: number
    resolved: number
    critical: number
    high: number
    medium: number
    low: number
  }

  // Compliance by site
  complianceBySite: { site: string; total: number; complete: number; overdue: number; rate: number }[]

  // Trend data
  months: { label: string; tests: number; pass: number; checks: number; complete: number }[]
}

// ---------- helpers ----------

const thin = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin }

function headerCell(text: string, colour: string, widthPct?: number): TableCell {
  return new TableCell({
    borders: cellBorders,
    shading: { type: ShadingType.CLEAR, fill: colour },
    verticalAlign: VerticalAlign.CENTER,
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text, bold: true, size: 18, color: 'FFFFFF', font: 'Calibri' })] })],
  })
}

function dataCell(text: string, opts: { bold?: boolean; color?: string; align?: typeof AlignmentType[keyof typeof AlignmentType] } = {}): TableCell {
  return new TableCell({
    borders: cellBorders,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      spacing: { before: 30, after: 30 },
      alignment: opts.align,
      children: [new TextRun({ text, size: 18, font: 'Calibri', bold: opts.bold, color: opts.color })],
    })],
  })
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: 'Calibri' })],
  })
}

function kpiLine(label: string, value: string | number, color?: string): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({ text: `${label}: `, size: 20, font: 'Calibri' }),
      new TextRun({ text: String(value), size: 20, font: 'Calibri', bold: true, color }),
    ],
  })
}

// ---------- generator ----------

export async function generateComplianceReport(input: ComplianceReportInput): Promise<Buffer> {
  const colour = input.primaryColour || '3DA8D8'
  const m = input.maintenance
  const t = input.testing
  const isDetailed = input.complexity === 'detailed'
  const isSummary = input.complexity === 'summary'

  const sections: Paragraph[] = []

  // ── Cover ──
  sections.push(
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: 'Compliance Report', bold: true, size: 52, color: colour, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: input.filterDescription, size: 24, font: 'Calibri', color: '666666' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: `Generated: ${input.generatedDate}`, size: 20, font: 'Calibri', color: '999999' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.tenantProductName, size: 20, font: 'Calibri', color: colour, bold: true })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  )

  // ── Maintenance Compliance ──
  sections.push(sectionHeading('Maintenance Compliance'))
  sections.push(kpiLine('Compliance Rate', `${m.complianceRate}%`, m.complianceRate >= 80 ? '00AA00' : m.complianceRate >= 50 ? 'CC8800' : 'CC0000'))
  sections.push(kpiLine('Total Checks', m.total))
  sections.push(kpiLine('Complete', m.complete, '00AA00'))
  sections.push(kpiLine('In Progress', m.inProgress, '3DA8D8'))
  sections.push(kpiLine('Scheduled', m.scheduled))
  sections.push(kpiLine('Overdue', m.overdue, m.overdue > 0 ? 'CC0000' : '00AA00'))
  sections.push(kpiLine('Cancelled', m.cancelled))

  // ── Testing Results ──
  sections.push(sectionHeading('Testing Results'))
  sections.push(kpiLine('Pass Rate', `${t.passRate}%`, t.passRate >= 80 ? '00AA00' : t.passRate >= 50 ? 'CC8800' : 'CC0000'))
  sections.push(kpiLine('Total Tests', t.total))
  sections.push(kpiLine('Pass', t.pass, '00AA00'))
  sections.push(kpiLine('Fail', t.fail, t.fail > 0 ? 'CC0000' : undefined))
  sections.push(kpiLine('Defect', t.defect, t.defect > 0 ? 'CC8800' : undefined))
  sections.push(kpiLine('Pending', t.pending))

  // ── ACB / NSX Workflow Progress ──
  if (!isSummary && (input.acb.total > 0 || input.nsx.total > 0)) {
    sections.push(sectionHeading('Breaker Testing Progress'))

    if (input.acb.total > 0) {
      sections.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'ACB (Air Circuit Breakers)', bold: true, size: 20, font: 'Calibri' })] }))
      sections.push(kpiLine('Total', input.acb.total))
      sections.push(kpiLine('Complete', input.acb.complete, '00AA00'))
      sections.push(kpiLine('In Progress', input.acb.inProgress, '3DA8D8'))
      sections.push(kpiLine('Not Started', input.acb.notStarted))
    }

    if (input.nsx.total > 0) {
      sections.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'NSX / MCCB', bold: true, size: 20, font: 'Calibri' })] }))
      sections.push(kpiLine('Total', input.nsx.total))
      sections.push(kpiLine('Complete', input.nsx.complete, '00AA00'))
      sections.push(kpiLine('In Progress', input.nsx.inProgress, '3DA8D8'))
      sections.push(kpiLine('Not Started', input.nsx.notStarted))
    }
  }

  // ── Defects Register ──
  if (input.defects.total > 0) {
    sections.push(sectionHeading('Defects Register'))
    sections.push(kpiLine('Total Defects', input.defects.total))
    sections.push(kpiLine('Open', input.defects.open, input.defects.open > 0 ? 'CC0000' : undefined))
    sections.push(kpiLine('In Progress', input.defects.inProgress, 'CC8800'))
    sections.push(kpiLine('Resolved / Closed', input.defects.resolved, '00AA00'))

    if (!isSummary) {
      sections.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'By Severity', bold: true, size: 20, font: 'Calibri' })] }))
      sections.push(kpiLine('Critical', input.defects.critical, input.defects.critical > 0 ? 'CC0000' : undefined))
      sections.push(kpiLine('High', input.defects.high, input.defects.high > 0 ? 'CC0000' : undefined))
      sections.push(kpiLine('Medium', input.defects.medium))
      sections.push(kpiLine('Low', input.defects.low))
    }
  }

  // ── Compliance by Site table ──
  if (input.complianceBySite.length > 0 && !isSummary) {
    sections.push(sectionHeading('Compliance by Site'))
    const siteTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell('Site', colour, 40),
            headerCell('Total', colour, 15),
            headerCell('Complete', colour, 15),
            headerCell('Overdue', colour, 15),
            headerCell('Rate', colour, 15),
          ],
        }),
        ...input.complianceBySite.map((row) =>
          new TableRow({
            children: [
              dataCell(row.site),
              dataCell(String(row.total), { align: AlignmentType.RIGHT }),
              dataCell(String(row.complete), { align: AlignmentType.RIGHT, color: '00AA00' }),
              dataCell(String(row.overdue), { align: AlignmentType.RIGHT, color: row.overdue > 0 ? 'CC8800' : undefined }),
              dataCell(`${row.rate}%`, { align: AlignmentType.RIGHT, bold: true, color: row.rate >= 80 ? '00AA00' : row.rate >= 50 ? 'CC8800' : 'CC0000' }),
            ],
          })
        ),
      ],
    })
    sections.push(new Paragraph({ spacing: { before: 100 } }))
    sections.push(siteTable as unknown as Paragraph)
  }

  // ── 6-Month Trend table (detailed only) ──
  // Explicit column widths (sum to 100) — matches the shape of the
  // Compliance-by-Site table above. Earlier revisions left widths
  // undefined here which, on some docx/Word paths, forced the renderer
  // to fall back to content-based sizing and produced a malformed
  // column set in the .docx XML. Keep the widths explicit.
  if (isDetailed && input.months.length > 0) {
    sections.push(sectionHeading('6-Month Trend'))
    const trendTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell('Month', colour, 20),
            headerCell('Tests', colour, 20),
            headerCell('Pass', colour, 20),
            headerCell('Checks', colour, 20),
            headerCell('Complete', colour, 20),
          ],
        }),
        ...input.months.map((mo) =>
          new TableRow({
            children: [
              dataCell(mo.label ?? ''),
              dataCell(String(mo.tests ?? 0), { align: AlignmentType.RIGHT }),
              dataCell(String(mo.pass ?? 0), { align: AlignmentType.RIGHT, color: '00AA00' }),
              dataCell(String(mo.checks ?? 0), { align: AlignmentType.RIGHT }),
              dataCell(String(mo.complete ?? 0), { align: AlignmentType.RIGHT, color: '00AA00' }),
            ],
          })
        ),
      ],
    })
    sections.push(new Paragraph({ spacing: { before: 100 } }))
    sections.push(trendTable as unknown as Paragraph)
  }

  // ── Header / Footer via shared ReportShell ─────────────────────────────
  // Sprint 2.3 (2026-04-26): first generator to adopt report-shell.ts.
  // The shell delivers the standard EQ header/footer (sky border, brand
  // typography, "Page X of Y" right-aligned). Cover + sign-off remain
  // bespoke for compliance reports until those sections migrate too —
  // header/footer are the lowest-risk first step.
  const shellSettings: ShellSettings = resolveShellSettings({
    companyName: input.tenantProductName,
    productName: input.tenantProductName,
    primaryColour: input.primaryColour ? `#${input.primaryColour}` : '#3DA8D8',
    complexity: input.complexity,
  })
  const shell = await prepareShell(shellSettings, {
    reportType: 'compliance',
    reportDate: input.generatedDate,
    customerName: null,
    siteName: null,
    siteAddress: null,
    customerLogoUrl: null,
    sitePhotoUrl: null,
  })

  // ── Build document ──
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1200, right: 1200 } },
      },
      headers: { default: buildShellHeader(shell) },
      footers: { default: buildShellFooter(shell) },
      children: sections,
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
