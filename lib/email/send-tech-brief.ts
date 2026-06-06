/**
 * send-tech-brief.ts
 *
 * Sends the pre-visit technician brief email with an .ics calendar attachment.
 * Phase 1 of the pre-visit tech brief spec (docs/runbooks/pre-visit-tech-brief-spec.md).
 *
 * Channels:   Resend (email) + .ics attachment
 * Trigger:    Manual "Send brief" button on /maintenance/[id] (admin/supervisor only)
 * Phase 2:    Automated cron at 17:00 day-before (not in this build)
 */

import { Resend } from 'resend'

export interface TechBriefEmailInput {
  to: string
  recipientName: string | null
  tenantName: string
  primaryColour?: string
  /** e.g. "Greystanes — Switchboard PPM (Annual)" */
  checkTitle: string
  siteName: string
  siteAddress: string | null
  siteCity: string | null
  siteState: string | null
  /** Gate code / access code notes */
  gateCode: string | null
  /** Parking notes */
  parkingNotes: string | null
  /** After-hours phone */
  afterHoursPhone: string | null
  /** Safety notes — surfaced with a red accent in the email */
  safetyNotes: string | null
  /** Site primary contact — who the tech calls on arrival */
  siteContact?: {
    name: string | null
    role: string | null
    phone: string | null
    email: string | null
  } | null
  /** Prior-visit summary — last completed check at this site and what it found */
  priorVisit?: {
    date: string
    defectCount: number
    failedItemCount: number
    topDefects: string[]
  } | null
  /** ISO datetime — when the visit is scheduled to start */
  scheduledStartAt: string
  /** Number of assets in the check */
  assetCount: number
  /** Deep link back to the check in the app */
  checkUrl: string
  /** Pre-formatted ICS content (RFC 5545) */
  icsContent: string
  /** Extra binary attachments (run-sheet DOCX, last-visit report DOCX) */
  attachments?: { filename: string; content: Buffer }[]
}

const FROM_ADDRESS = 'EQ Solves Service <contact@eq.solutions>'
const REPLY_TO_ADDRESS = 'contact@eq.solutions'

/** Minimal HTML entity escape for user-provided strings. */
function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendTechBriefEmail(
  input: TechBriefEmailInput,
): Promise<{ skipped: true } | { id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping tech brief email')
    return { skipped: true }
  }

  const resend = new Resend(apiKey)
  const brand = input.primaryColour || '#3DA8D8'
  const deepBrand = darken(brand)

  const startDate = new Date(input.scheduledStartAt)
  const visitDateLabel = startDate.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const visitTimeLabel = startDate.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const greeting = input.recipientName
    ? `Hi ${input.recipientName.split(' ')[0]},`
    : 'Hi,'

  const addressLine = [input.siteAddress, input.siteCity, input.siteState]
    .filter(Boolean)
    .join(', ')
  const mapsUrl = addressLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`
    : null

  const subject = `Tomorrow ${visitTimeLabel} — ${input.siteName} — ${input.checkTitle}`

  const safetyBlock = input.safetyNotes
    ? `
    <div style="margin: 20px 0; padding: 12px 16px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 0 6px 6px 0;">
      <p style="font-size: 12px; font-weight: 700; color: #991b1b; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.05em;">Safety notes</p>
      <p style="font-size: 13px; color: #7f1d1d; margin: 0; white-space: pre-line;">${esc(input.safetyNotes)}</p>
    </div>`
    : ''

  const contact = input.siteContact
  const contactBlock = (contact && (contact.name || contact.phone || contact.email))
    ? `
    <h2 style="font-size: 14px; font-weight: 700; color: #111827; margin: 24px 0 8px;">Site contact</h2>
    <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      ${contact.name ? `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; width: 36%; vertical-align: top; white-space: nowrap;">Name</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827;">${esc(contact.name)}${contact.role ? ` <span style="color: #6b7280;">— ${esc(contact.role)}</span>` : ''}</td>
      </tr>` : ''}
      ${contact.phone ? `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; white-space: nowrap;">Phone</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827;"><a href="tel:${esc(contact.phone)}" style="color: ${brand};">${esc(contact.phone)}</a></td>
      </tr>` : ''}
      ${contact.email ? `
      <tr>
        <td style="padding: 10px 14px; font-size: 12px; color: #6b7280; white-space: nowrap;">Email</td>
        <td style="padding: 10px 14px; font-size: 13px; color: #111827;"><a href="mailto:${esc(contact.email)}" style="color: ${brand};">${esc(contact.email)}</a></td>
      </tr>` : ''}
    </table>`
    : ''

  const pv = input.priorVisit
  const priorVisitBlock = (pv && pv.date)
    ? `
    <h2 style="font-size: 14px; font-weight: 700; color: #111827; margin: 24px 0 8px;">Last visit</h2>
    <div style="padding: 12px 16px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
      <p style="font-size: 13px; color: #374151; margin: 0 0 ${pv.topDefects.length ? '8px' : '0'};">
        <strong>${esc(new Date(pv.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }))}</strong>
        — ${pv.defectCount} defect${pv.defectCount === 1 ? '' : 's'} raised, ${pv.failedItemCount} item${pv.failedItemCount === 1 ? '' : 's'} failed.
      </p>
      ${pv.topDefects.length ? `<ul style="font-size: 12px; color: #6b7280; margin: 0; padding-left: 18px;">${pv.topDefects.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    </div>`
    : ''

  const accessBlock = (input.gateCode || input.parkingNotes || input.afterHoursPhone)
    ? `
    <h2 style="font-size: 14px; font-weight: 700; color: #111827; margin: 24px 0 8px;">Site access</h2>
    <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      ${input.gateCode ? `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; width: 36%; vertical-align: top; white-space: nowrap;">Gate / access</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827; white-space: pre-line;">${esc(input.gateCode)}</td>
      </tr>` : ''}
      ${input.parkingNotes ? `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; vertical-align: top; white-space: nowrap;">Parking</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #111827; white-space: pre-line;">${esc(input.parkingNotes)}</td>
      </tr>` : ''}
      ${input.afterHoursPhone ? `
      <tr>
        <td style="padding: 10px 14px; font-size: 12px; color: #6b7280; white-space: nowrap;">After-hours phone</td>
        <td style="padding: 10px 14px; font-size: 13px; color: #111827;"><a href="tel:${esc(input.afterHoursPhone)}" style="color: ${brand};">${esc(input.afterHoursPhone)}</a></td>
      </tr>` : ''}
    </table>`
    : ''

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">

    <!-- Header -->
    <div style="background: ${brand}; padding: 24px; border-radius: 12px 12px 0 0; color: #fff;">
      <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 6px; opacity: 0.8;">Pre-visit brief</p>
      <h1 style="font-size: 20px; margin: 0 0 4px; font-weight: 700;">${esc(input.checkTitle)}</h1>
      <p style="font-size: 14px; margin: 0; opacity: 0.9;">${esc(input.siteName)}</p>
    </div>

    <!-- Body -->
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px;">
      <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">${greeting}</p>
      <p style="font-size: 14px; color: #374151; margin: 0 0 20px;">
        Here's your brief for tomorrow's visit. The calendar invite is attached — add it to your calendar now.
      </p>

      <!-- Visit details -->
      <table cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin: 0 0 20px;">
        <tr>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280; width: 36%;">Date</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827; font-weight: 600;">${esc(visitDateLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280;">Start time</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827; font-weight: 600;">${esc(visitTimeLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280;">Site</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #111827;">
            ${esc(input.siteName)}
            ${mapsUrl ? `<br><a href="${esc(mapsUrl)}" style="font-size: 12px; color: ${brand};">Open in Maps</a>` : ''}
          </td>
        </tr>
        ${addressLine ? `
        <tr>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280;">Address</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #374151;">${esc(addressLine)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 10px 14px; font-size: 12px; color: #6b7280;">Assets</td>
          <td style="padding: 10px 14px; font-size: 14px; color: #111827;">${input.assetCount} to check</td>
        </tr>
      </table>

      ${safetyBlock}
      ${accessBlock}
      ${contactBlock}
      ${priorVisitBlock}

      <!-- CTA -->
      <div style="text-align: center; margin: 28px 0 8px;">
        <a href="${esc(input.checkUrl)}" style="display: inline-block; padding: 13px 32px; background: ${brand}; color: #fff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 700;">
          Open check in EQ Service
        </a>
      </div>
      <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 12px 0 0;">
        Sent by ${esc(input.tenantName)} via EQ Solves Service
      </p>
    </div>
  </div>
</body></html>`.trim()

  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: input.to,
    replyTo: REPLY_TO_ADDRESS,
    subject,
    html,
    attachments: [
      {
        filename: 'visit.ics',
        content: Buffer.from(input.icsContent, 'utf-8').toString('base64'),
      },
      ...(input.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
      })),
    ],
  })

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`)
  }
  return { id: result.data?.id ?? 'unknown' }
}

/** Naive hex darkener — shifts each RGB channel down by 20%. */
function darken(hex: string): string {
  try {
    const h = hex.replace('#', '')
    const r = Math.floor(parseInt(h.slice(0, 2), 16) * 0.8)
    const g = Math.floor(parseInt(h.slice(2, 4), 16) * 0.8)
    const b = Math.floor(parseInt(h.slice(4, 6), 16) * 0.8)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  } catch {
    return hex
  }
}
