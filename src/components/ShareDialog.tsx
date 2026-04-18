import { useEffect, useRef, useState } from 'react'
import { EqMark } from './EqMark'

interface Props {
  url: string
  title: string
  subtitle?: string
  pin?: string | null
  onClose: () => void
}

export function ShareDialog({ url, title, subtitle, pin, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Lazy-load qrcode so it doesn't bloat the main bundle
    void import('qrcode').then((QR) => {
      if (!canvasRef.current) return
      QR.toCanvas(canvasRef.current, url, {
        width: 260,
        margin: 1,
        color: { dark: '#1A1A2E', light: '#FFFFFF' },
      }).catch(() => {})
    })
  }, [url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard blocked — fall back to selection
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {}
      input.remove()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/70 backdrop-blur flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-sky-soft flex items-center justify-center text-muted"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-2 mb-0.5">
          <EqMark size={16} aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Asset Capture</span>
        </div>
        <h2 className="font-bold text-lg text-ink">{title}</h2>
        {subtitle ? <p className="text-sm text-muted mb-3">{subtitle}</p> : null}

        <div className="flex justify-center my-4">
          <div className="p-3 border border-border rounded-xl bg-white">
            <canvas ref={canvasRef} />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">Link</div>
            <div className="flex gap-2">
              <input
                value={url}
                readOnly
                className="field-input mono text-xs flex-1"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button onClick={copy} className="btn btn-primary btn-md whitespace-nowrap">
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {pin ? (
            <div className="bg-sky-soft border border-sky/20 rounded-xl p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-deep mb-1">PIN</div>
              <div className="text-2xl font-bold mono text-ink tracking-widest">{pin}</div>
              <div className="text-[10px] text-muted mt-1">Send this out-of-band (SMS or phone call).</div>
            </div>
          ) : (
            <div className="text-[11px] text-muted">No PIN set on this job — the link alone is enough to access.</div>
          )}
        </div>
      </div>
    </div>
  )
}
