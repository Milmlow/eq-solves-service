/**
 * send-customer-monthly-summary.ts
 *
 * Sends the commercial-tier "monthly summary" email — the customer-
 * facing equivalent of the supervisor digest. One email per
 * customer_contact whose customer_notification_preferences.receive_
 * monthly_summary is true and whose monthly_summary_day matches the
 * current day-of-month.
 *
 * Same graceful-degradation pattern as send-report-email: if
 * RESEND_API_KEY is missing the helper returns `{ skipped: true }` so
 * the cron summary records "tried but no backend".
 *
 * Returns either { skipped: true } or { id: string } (Resend message id)
 * for the audit trail.
 */

import { Resend } from 'resend'

export interface MonthlySummaryEmailInput {
  to: string
  contactName: string | null
  customerName: string
  tenantName: string
  /** Used for the "View in portal" CTA. */
  portalUrl: string
  /** Period the summary covers. */
  periodStart: string  // ISO date
  periodEnd: string    // ISO date
  /** Counts for the period. */
  visitsCompleted: number
  visitsScheduled: number
  defectsOpenAtPeriodEnd: number
  defectsRaisedThisPeriod: number
  variationsApprovedThisPeriod: number
  /** Top-line per-site rows for the body. */
  perSite: Array<{
    siteName: string
    visitsThisPeriod: number
    nextVisitDate: string | null
    openDefects: number
  }>
  primaryColour?: string
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

export async function sendCustomerMonthlySummaryEmail(
  input: MonthlySummaryEmailInput,
): Promise<{ skipped: true } | { id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping customer monthly summary')
    return { skipped: true }
  }

  const resend = new Resend(apiKey)
  const brand = input.primaryColour || '#3DA8D8'

  const periodLabel = `${formatDate(input.periodStart)} – ${formatDate(input.periodEnd)}`
  const subject = `Maintenance summary — ${input.customerName} — ${periodLabel}`

  const greeting = input.contactName ? `Hi ${input.contactName.split(' ')[0]},` : 'Hello,'

  const siteRows = input.perSite.map(s => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px;">${escape(s.siteName)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px; text-align: right;">${s.visitsThisPeriod}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px;">${s.nextVisitDate ? formatDate(s.nextVisitDate) : '—'}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px; text-align: right; color: ${s.openDefects > 0 ? '#dc2626' : '#6b7280'};">${s.openDefects}</td>
    </tr>
  `).join('')

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: ${brand}; padding: 24px; border-radius: 12px 12px 0 0; color: #fff;">
      <h1 style="font-size: 20px; margin: 0 0 4px; font-weight: 600;">Maintenance Summary</h1>
      <p style="font-size: 14px; margin: 0; opacity: 0.9;">${escape(input.customerName)} · ${periodLabel}</p>
    </div>
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px;">
      <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">${greeting}</p>
      <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">
        Here's what ${escape(input.tenantName)} delivered for ${escape(input.customerName)} this period.
      </p>

      <!-- Headline metrics -->
      <table cellspacing="0" cellpadding="0" style="width: 100%; margin: 16px 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 12px; background: #f9fafb; border-radius: 8px; text-align: center; width: 25%;">
            <div style="font-size: 22px; font-weight: 700; color: #059669;">${input.visitsCompleted}</div>
            <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Visits done</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 12px; background: #f9fafb; border-radius: 8px; text-align: center; width: 25%;">
            <div style="font-size: 22px; font-weight: 700; color: #1f2937;">${input.visitsScheduled}</div>
            <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Upcoming</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 12px; background: #f9fafb; border-radius: 8px; text-align: center; width: 25%;">
            <div style="font-size: 22px; font-weight: 700; color: ${input.defectsOpenAtPeriodEnd > 0 ? '#dc2626' : '#1f2937'};">${input.defectsOpenAtPeriodEnd}</div>
            <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Open defects</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 12px; background: #f9fafb; border-radius: 8px; text-align: center; width: 25%;">
            <div style="font-size: 22px; font-weight: 700; color: #1f2937;">${input.variationsApprovedThisPeriod}</div>
            <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Variations</div>
          </td>
        </tr>
      </table>

      <!-- Per-site -->
      ${input.perSite.length > 0 ? `
      <h3 style="font-size: 14px; color: #111827; margin: 24px 0 8px; font-weight: 600;">By site</h3>
      <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Site</th>
            <th style="padding: 10px 12px; text-align: right; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Visits</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Next visit</th>
            <th style="padding: 10px 12px; text-align: right; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">Open defects</th>
          </tr>
        </thead>
        <tbody>${siteRows}</tbody>
      </table>
      ` : ''}

      <!-- CTA -->
      <div style="text-align: center; margin: 28px 0 8px;">
        <a href="${input.portalUrl}" style="display: inline-block; padding: 12px 28px; background: ${brand}; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">View in portal</a>
      </div>
      <p style="font-size: 12px; color: #6b7280; text-align: center; margin: 16px 0 0;">
        You're receiving this because you're listed as a contact for ${escape(input.customerName)}. Reply to this email to update your preferences.
      </p>
    </div>
  </div>
</body></html>
  `.trim()

  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: input.to,
    replyTo: REPLY_TO_ADDRESS,
    subject,
    html,
  })

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`)
  }
  return { id: result.data?.id ?? 'unknown' }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
