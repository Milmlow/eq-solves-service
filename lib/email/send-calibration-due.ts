/**
 * send-calibration-due.ts
 *
 * Reminder email for test instruments whose calibration is due within the
 * reminder window (default 30 days) or already overdue. Sent to the user
 * the instrument is assigned to, falling back to tenant supervisors/admins
 * when unassigned.
 *
 * An out-of-calibration instrument used on-site produces invalid test
 * results — a regulatory exposure for EQ/SKS and the customer. This closes
 * the loop so a lapsing cert is surfaced before the instrument is used.
 *
 * Same graceful-degradation contract as the other Service email helpers:
 * when RESEND_API_KEY is absent the function returns `{ skipped: true }`
 * and the caller still writes the bell notification.
 */

import { Resend } from 'resend'

export interface CalibrationDueEmailInput {
  to: string
  recipientName: string | null
  tenantName: string
  /** Instruments due/overdue, already filtered + sorted by the caller. */
  instruments: Array<{
    name: string
    instrumentType: string
    serialNumber: string | null
    calibrationDue: string
    /** True when calibration_due < today. */
    overdue: boolean
  }>
  appUrl: string
  primaryColour?: string
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

export async function sendCalibrationDueEmail(
  input: CalibrationDueEmailInput,
): Promise<{ skipped: true } | { id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping calibration-due email')
    return { skipped: true }
  }
  if (input.instruments.length === 0) return { skipped: true }

  const resend = new Resend(apiKey)
  const brand = input.primaryColour || '#3DA8D8'
  const anyOverdue = input.instruments.some((i) => i.overdue)
  const headerColour = anyOverdue ? '#dc2626' : '#d97706'
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hello,'
  const count = input.instruments.length
  const subject = anyOverdue
    ? `Instrument calibration overdue (${count})`
    : `Instrument calibration due soon (${count})`
  const instrumentsUrl = `${input.appUrl}/instruments`

  const rows = input.instruments
    .map((i) => {
      const dueLabel = new Date(i.calibrationDue).toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      const statusChip = i.overdue
        ? '<span style="color:#dc2626;font-weight:600;">Overdue</span>'
        : '<span style="color:#d97706;font-weight:600;">Due soon</span>'
      return `
        <tr>
          <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827; font-weight: 600;">${escape(i.name)}</td>
          <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #6b7280;">${escape(i.instrumentType)}${i.serialNumber ? ` · ${escape(i.serialNumber)}` : ''}</td>
          <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827; white-space: nowrap;">${dueLabel}</td>
          <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; white-space: nowrap;">${statusChip}</td>
        </tr>`
    })
    .join('')

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">
    <div style="background: ${headerColour}; padding: 24px; border-radius: 12px 12px 0 0; color: #fff;">
      <p style="font-size: 12px; margin: 0 0 4px; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Calibration reminder</p>
      <h1 style="font-size: 20px; margin: 0; font-weight: 600;">${count} instrument${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} calibration</h1>
    </div>
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px;">
      <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">${greeting}</p>
      <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">
        The following test instrument${count === 1 ? '' : 's'} on the ${escape(input.tenantName)} register ${count === 1 ? 'is' : 'are'} due for calibration. Using an out-of-calibration instrument on-site can invalidate test results — arrange calibration before the next visit.
      </p>

      <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px;">
        ${rows}
      </table>

      <div style="text-align: center; margin: 24px 0 8px;">
        <a href="${instrumentsUrl}" style="display: inline-block; padding: 12px 28px; background: ${brand}; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">Open instrument register</a>
      </div>

      <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0; text-align: center;">
        You're receiving this because ${count === 1 ? 'this instrument is' : 'these instruments are'} assigned to you, or you manage the ${escape(input.tenantName)} tenant. Manage notification preferences in app settings.
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

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
