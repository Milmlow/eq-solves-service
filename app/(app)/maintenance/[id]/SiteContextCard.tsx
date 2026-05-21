/**
 * SiteContextCard — "where do I need to go" callout at the top of
 * /maintenance/[id]. Surfaces address + contact + map deep link so the
 * tech can start their day in the right car park.
 *
 * Server-rendered. Reads only the fields the page already pulls. Renders
 * nothing if the site has no address AND no contact AND no photo — i.e.
 * the card never shows just a name. Better to render nothing than a
 * placeholder that looks broken.
 *
 * Future fields to surface as the data captures fill in (none of these
 * exist in the sites schema today):
 *   - Gate / access codes
 *   - Parking notes
 *   - After-hours contact
 *   - Site-specific safety notes
 * When those land, add them here.
 */

import Link from 'next/link'
import { MapPin, Phone, Navigation, User, Key, Car, ShieldAlert, PhoneCall } from 'lucide-react'

interface SiteContextCardProps {
  site: {
    name: string
    code: string | null
    address: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
    latitude: number | null
    longitude: number | null
    photo_url: string | null
    /** Free-text access instructions — gate / dock / front-door code or steps. */
    gate_code: string | null
    /** Where to park, restrictions, after-hours options. */
    parking_notes: string | null
    /** Out-of-hours emergency contact, distinct from the daytime primary contact. */
    after_hours_phone: string | null
    /** Site-specific safety requirements: PPE, isolation, induction-required, etc. */
    safety_notes: string | null
  }
  contact: {
    name: string
    role: string | null
    phone: string | null
    email: string | null
  } | null
}

/** Concatenate the address parts that exist, in standard AU order. */
function formatAddress(site: SiteContextCardProps['site']): string | null {
  const parts: string[] = []
  if (site.address) parts.push(site.address)
  const cityStatePc = [site.city, site.state, site.postcode].filter(Boolean).join(' ')
  if (cityStatePc) parts.push(cityStatePc)
  if (site.country && site.country.toUpperCase() !== 'AU' && site.country.toLowerCase() !== 'australia') {
    parts.push(site.country)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Build the deep link the "Open in Maps" button uses.
 *
 * If we have lat/lng, prefer that — it's unambiguous and Google/Apple
 * Maps both honour the `?q=lat,lng` form. Otherwise fall back to the
 * address string URL-encoded; Maps app's fuzzy resolver handles the
 * rest. Returns null when there's nothing to send.
 */
function buildMapHref(site: SiteContextCardProps['site']): string | null {
  if (site.latitude !== null && site.longitude !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${site.latitude},${site.longitude}`
  }
  const addr = formatAddress(site)
  if (addr) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`
  }
  return null
}

/** Build a `tel:` href from a phone string, stripping anything not a digit, +, or *. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+*]/g, '')}`
}

export function SiteContextCard({ site, contact }: SiteContextCardProps) {
  const address = formatAddress(site)
  const mapHref = buildMapHref(site)
  const hasAccessFields = !!(site.gate_code || site.parking_notes || site.after_hours_phone || site.safety_notes)
  const hasAnyContent = address || contact || site.photo_url || hasAccessFields

  if (!hasAnyContent) return null

  return (
    <div className="rounded-xl border border-eq-line bg-white overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* Optional site photo — left-rail on tablet+, top-strip on phone */}
        {site.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={site.photo_url}
            alt={`${site.name} entrance`}
            className="w-full sm:w-48 h-32 sm:h-auto object-cover shrink-0"
            loading="lazy"
          />
        )}
        <div className="flex-1 p-4 space-y-3">
          {/* Title + code */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-eq-ink">{site.name}</h2>
                {site.code && (
                  <span className="text-xs font-mono text-eq-grey">{site.code}</span>
                )}
              </div>
            </div>
          </div>

          {/* Address row */}
          {address && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 mt-0.5 text-eq-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-eq-ink">{address}</p>
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 min-h-[44px] mt-1 text-sm font-semibold text-eq-deep hover:text-eq-sky touch-manipulation"
                  >
                    <Navigation className="w-4 h-4" />
                    Open in Maps
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Contact row */}
          {contact && (contact.name || contact.phone) && (
            <div className="flex items-start gap-2 text-sm border-t border-eq-line pt-3">
              <User className="w-4 h-4 mt-0.5 text-eq-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-eq-ink">
                  <span className="font-medium">{contact.name || 'Site contact'}</span>
                  {contact.role && <span className="text-eq-grey"> · {contact.role}</span>}
                </p>
                {contact.phone && (
                  <a
                    href={telHref(contact.phone)}
                    className="inline-flex items-center gap-1 min-h-[44px] mt-1 text-sm font-semibold text-eq-deep hover:text-eq-sky touch-manipulation"
                  >
                    <Phone className="w-4 h-4" />
                    {contact.phone}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* After-hours phone — distinct from the primary contact because
              the on-call number is usually a different person/number. */}
          {site.after_hours_phone && (
            <div className="flex items-start gap-2 text-sm border-t border-eq-line pt-3">
              <PhoneCall className="w-4 h-4 mt-0.5 text-eq-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wider">After hours</p>
                <a
                  href={telHref(site.after_hours_phone)}
                  className="inline-flex items-center gap-1 min-h-[44px] text-sm font-semibold text-eq-deep hover:text-eq-sky touch-manipulation"
                >
                  <Phone className="w-4 h-4" />
                  {site.after_hours_phone}
                </a>
              </div>
            </div>
          )}

          {/* Gate / access code — the field that saves the tech 20 minutes
              of standing at a locked dock on their first visit. */}
          {site.gate_code && (
            <div className="flex items-start gap-2 text-sm border-t border-eq-line pt-3">
              <Key className="w-4 h-4 mt-0.5 text-eq-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wider">Access</p>
                <p className="text-eq-ink whitespace-pre-line">{site.gate_code}</p>
              </div>
            </div>
          )}

          {/* Parking notes */}
          {site.parking_notes && (
            <div className="flex items-start gap-2 text-sm border-t border-eq-line pt-3">
              <Car className="w-4 h-4 mt-0.5 text-eq-deep shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wider">Parking</p>
                <p className="text-eq-ink whitespace-pre-line">{site.parking_notes}</p>
              </div>
            </div>
          )}

          {/* Safety notes — rendered with a red accent because PPE / isolation
              info is the kind of thing you want a tech to actually READ. */}
          {site.safety_notes && (
            <div className="flex items-start gap-2 text-sm border-t border-eq-line pt-3 bg-red-50/40 -mx-4 px-4 -mb-1 pb-3 rounded-b-xl sm:rounded-none">
              <ShieldAlert className="w-4 h-4 mt-0.5 text-red-700 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-red-800 uppercase tracking-wider">Site safety</p>
                <p className="text-eq-ink whitespace-pre-line">{site.safety_notes}</p>
              </div>
            </div>
          )}

          {/* Soft prompt when address is missing — supervisor sees this and
              knows to capture it on first visit. Plain text, not a CTA. */}
          {!address && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
              No address recorded for this site yet.{' '}
              <Link href={`/sites/${encodeURIComponent(site.code ?? '')}`} className="underline font-semibold">
                Add one
              </Link>
              {' '}so the next tech can navigate straight there.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
