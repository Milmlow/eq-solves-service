/**
 * build-ics.ts
 *
 * Minimal RFC 5545 VCALENDAR / VEVENT builder.
 * No external dependencies — keeps the bundle small and avoids
 * ics library version drift.
 *
 * Spec:
 *   - Tech as ATTENDEE (ROLE=REQ-PARTICIPANT)
 *   - Tenant as ORGANIZER
 *   - Default duration 4 hours unless durationMinutes is supplied
 *   - VALARM at 60 min + 15 min before start (DISPLAY)
 *
 * Phase 1 of the pre-visit tech brief (service-feature-backlog #1 / spec
 * at docs/runbooks/pre-visit-tech-brief-spec.md decision #7).
 */

export interface IcsInput {
  uid: string
  summary: string
  description?: string
  location?: string | null
  /** ISO 8601 datetime — visit start */
  startAt: string
  /** Minutes of visit duration. Defaults to 240 (4 hours). */
  durationMinutes?: number
  techEmail: string
  techName: string | null
  organizerEmail: string
  organizerName: string
}

/** Format a Date as YYYYMMDDTHHMMSSZ (UTC, Zulu) */
function toIcsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** RFC 5545 line folding — lines > 75 octets get a CRLF + SPACE continuation. */
function fold(line: string): string {
  const MAX = 75
  if (Buffer.byteLength(line, 'utf8') <= MAX) return line
  const chunks: string[] = []
  let i = 0
  while (i < line.length) {
    // Grab up to MAX bytes worth of characters (char boundary safe for BMP)
    let end = i
    let bytes = 0
    while (end < line.length) {
      const charBytes = Buffer.byteLength(line[end], 'utf8')
      if (bytes + charBytes > (chunks.length === 0 ? MAX : MAX - 1)) break
      bytes += charBytes
      end++
    }
    chunks.push(line.slice(i, end))
    i = end
  }
  return chunks.join('\r\n ')
}

function prop(name: string, value: string): string {
  return fold(`${name}:${value}`)
}

function escIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function buildIcs(input: IcsInput): string {
  const durationMin = input.durationMinutes ?? 240
  const start = new Date(input.startAt)
  const end = new Date(start.getTime() + durationMin * 60 * 1000)
  const now = new Date()

  const techCn = input.techName ? `CN="${escIcs(input.techName)}":` : ''
  const orgCn = `CN="${escIcs(input.organizerName)}":MAILTO:${input.organizerEmail}`

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    prop('VERSION', '2.0'),
    prop('PRODID', '-//EQ Solves Service//EQ Service//EN'),
    prop('CALSCALE', 'GREGORIAN'),
    prop('METHOD', 'REQUEST'),
    'BEGIN:VEVENT',
    prop('UID', input.uid),
    prop('DTSTAMP', toIcsUtc(now)),
    prop('DTSTART', toIcsUtc(start)),
    prop('DTEND', toIcsUtc(end)),
    fold(`SUMMARY:${escIcs(input.summary)}`),
    ...(input.description ? [fold(`DESCRIPTION:${escIcs(input.description)}`)] : []),
    ...(input.location ? [fold(`LOCATION:${escIcs(input.location)}`)] : []),
    fold(`ORGANIZER;${orgCn}`),
    fold(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;${techCn}MAILTO:${input.techEmail}`),
    // 60-minute reminder
    'BEGIN:VALARM',
    prop('ACTION', 'DISPLAY'),
    fold(`DESCRIPTION:Reminder: ${escIcs(input.summary)}`),
    prop('TRIGGER', '-PT60M'),
    'END:VALARM',
    // 15-minute reminder
    'BEGIN:VALARM',
    prop('ACTION', 'DISPLAY'),
    fold(`DESCRIPTION:Starting soon: ${escIcs(input.summary)}`),
    prop('TRIGGER', '-PT15M'),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.join('\r\n')
}
