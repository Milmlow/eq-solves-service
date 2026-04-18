import { useEffect, useState } from 'react'
import { Mail, MessageSquare, Phone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSite } from '../hooks/useJobData'
import { EqMark } from './EqMark'

const BUCKET = 'site-drawings'

interface Props {
  siteCode: string
  onClose: () => void
}

export function SiteInfoSheet({ siteCode, onClose }: Props) {
  const { site, loading } = useSite(siteCode)
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null)

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  useEffect(() => {
    if (!site?.drawing_path) {
      setDrawingUrl(null)
      return
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(site.drawing_path)
    setDrawingUrl(data.publicUrl)
  }, [site?.drawing_path])

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/70 backdrop-blur flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <EqMark size={16} aria-hidden />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Site info
              </span>
            </div>
            <h2 className="font-bold text-lg text-ink truncate">
              {site?.display_name ?? siteCode}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 -mt-1 -mr-2 rounded-lg hover:bg-sky-soft flex items-center justify-center text-muted"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="text-sm text-muted text-center py-6">Loading…</div>
          ) : !site ? (
            <div className="text-sm text-muted text-center py-6">
              No site info configured for {siteCode}.
              <div className="mt-2 text-xs">
                Ask the office to add this in Supabase.
              </div>
            </div>
          ) : (
            <>
              {/* Contacts */}
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Contacts
                </div>
                {site.contacts.length === 0 ? (
                  <div className="card p-3 text-sm text-muted">No contacts listed.</div>
                ) : (
                  <div className="space-y-2">
                    {site.contacts.map((c, i) => (
                      <ContactCard key={i} contact={c} />
                    ))}
                  </div>
                )}
              </section>

              {/* Drawing */}
              <section>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                  Site layout
                </div>
                {drawingUrl ? (
                  <div className="space-y-2">
                    <a
                      href={drawingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary btn-md w-full justify-center"
                    >
                      <span className="mr-2">📄</span> Open layout PDF
                    </a>
                    <div className="text-[11px] text-muted text-center">
                      Opens in a new tab so you can flick between it and capture.
                    </div>
                  </div>
                ) : (
                  <div className="card p-3 text-sm text-muted">
                    No drawing uploaded yet.
                    <div className="text-xs mt-1">
                      Ask the office to upload one to the <span className="mono">site-drawings</span> bucket.
                    </div>
                  </div>
                )}
              </section>

              {/* Notes */}
              {site.notes ? (
                <section>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    Notes
                  </div>
                  <div className="card p-3 text-sm text-ink whitespace-pre-wrap">{site.notes}</div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ContactCard({ contact }: { contact: { role: string; name: string; phone?: string | null; email?: string | null } }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-deep mb-0.5">
        {contact.role}
      </div>
      <div className="font-semibold text-ink">{contact.name}</div>
      <div className="flex gap-2 mt-2">
        {contact.phone ? (
          <a
            href={`tel:${stripNonDial(contact.phone)}`}
            className="btn btn-primary btn-md flex-1 justify-center gap-1.5"
          >
            <Phone size={14} strokeWidth={2} />
            Call
          </a>
        ) : null}
        {contact.phone ? (
          <a
            href={`sms:${stripNonDial(contact.phone)}`}
            className="btn btn-ghost btn-md"
            aria-label="Text"
            title="Text"
          >
            <MessageSquare size={14} strokeWidth={2} />
          </a>
        ) : null}
        {contact.email ? (
          <a
            href={`mailto:${contact.email}`}
            className="btn btn-ghost btn-md"
            aria-label="Email"
            title="Email"
          >
            <Mail size={14} strokeWidth={2} />
          </a>
        ) : null}
      </div>
      {contact.phone ? (
        <div className="text-xs text-muted mono mt-1.5">{contact.phone}</div>
      ) : null}
      {contact.email ? (
        <div className="text-xs text-muted mono truncate">{contact.email}</div>
      ) : null}
    </div>
  )
}

function stripNonDial(raw: string) {
  // Keep digits and leading + for tel: URLs
  return raw.replace(/[^\d+]/g, '')
}
