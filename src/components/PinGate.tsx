import { useEffect, useState } from 'react'
import { Delete } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { EqMark } from './EqMark'
import { navigate } from '../lib/router'
import { Eyebrow } from './ui/Eyebrow'

const PIN_PASS_KEY_PREFIX = 'eq-pin-pass-v1:'

function passportKey(jobId: string) {
  return `${PIN_PASS_KEY_PREFIX}${jobId}`
}

// A simple passport stored in localStorage so the tech doesn't re-enter the
// PIN on every page navigation. Expires after 12 hours.
export function hasPinPass(jobId: string): boolean {
  try {
    const raw = localStorage.getItem(passportKey(jobId))
    if (!raw) return false
    const { expiresAt } = JSON.parse(raw) as { expiresAt: number }
    return Date.now() < expiresAt
  } catch {
    return false
  }
}

function grantPinPass(jobId: string) {
  const payload = { expiresAt: Date.now() + 12 * 60 * 60 * 1000 }
  localStorage.setItem(passportKey(jobId), JSON.stringify(payload))
}

// Checks whether the job requires a PIN at all. Uses the jobs_public view so
// we only receive a boolean `pin_required`, never the hash.
export async function fetchPinRequired(jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('jobs_public')
    .select('pin_required')
    .eq('id', jobId)
    .maybeSingle()
  if (error || !data) return false
  return Boolean((data as { pin_required: boolean }).pin_required)
}

export async function verifyPin(jobId: string, candidate: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_job_pin' as never, {
    job: jobId,
    candidate,
  } as never)
  if (error) return false
  return Boolean(data)
}

// ----------------------------------------------------------------------------

interface Props {
  jobId: string
  onPass: () => void
}

export function PinGate({ jobId, onPass }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(Date.now())

  // Tick while cooling down so the countdown updates
  useEffect(() => {
    if (cooldownUntil <= now) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [cooldownUntil, now])

  // Physical keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (cooldownUntil > Date.now() || checking) return
      if (e.key >= '0' && e.key <= '9') push(e.key)
      else if (e.key === 'Backspace') back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, cooldownUntil, checking])

  const cooldownRemaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const locked = cooldownRemaining > 0

  const push = (d: string) => {
    if (locked || checking) return
    if (pin.length >= 4) return
    const next = pin + d
    setError(null)
    setPin(next)
    if (next.length === 4) {
      setTimeout(() => {
        void submit(next)
      }, 150)
    }
  }

  const back = () => {
    if (locked || checking) return
    setPin((p) => p.slice(0, -1))
    setError(null)
  }

  const submit = async (candidate: string) => {
    if (locked) return
    setChecking(true)
    const ok = await verifyPin(jobId, candidate)
    setChecking(false)
    if (ok) {
      grantPinPass(jobId)
      onPass()
      return
    }
    const newAttempts = attempts + 1
    setAttempts(newAttempts)
    setPin('')

    // Progressive cooldown: 3rd wrong = 10s, 4th = 30s, 5th+ = 2min
    if (newAttempts >= 5) {
      setCooldownUntil(Date.now() + 120_000)
      setError('Too many wrong attempts. Wait 2 minutes before trying again, or check with the office.')
    } else if (newAttempts >= 4) {
      setCooldownUntil(Date.now() + 30_000)
      setError('Too many wrong attempts. Wait 30 seconds.')
    } else if (newAttempts >= 3) {
      setCooldownUntil(Date.now() + 10_000)
      setError('Too many wrong attempts. Wait 10 seconds.')
    } else {
      setError('Wrong PIN — check with the office.')
    }
  }

  const isError = Boolean(error) && !locked

  return (
    <div
      className="min-h-screen grid bg-white"
      style={{ gridTemplateColumns: 'minmax(0,1fr) 480px' }}
    >
      {/* ── Left: brand panel ──────────────────────────────────── */}
      <div
        className="relative overflow-hidden text-white p-[60px] flex flex-col"
        style={{
          background:
            'linear-gradient(135deg, #1A1A2E 0%, #2986B4 100%)',
        }}
      >
        {/* Decorative blurred blobs */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            top: -120,
            right: -120,
            width: 420,
            height: 420,
            background: 'rgba(61,168,216,0.18)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            bottom: -80,
            left: -80,
            width: 300,
            height: 300,
            background: 'rgba(61,168,216,0.12)',
            filter: 'blur(50px)',
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <EqMark variant="white" size={40} aria-hidden />
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div
            className="text-[11px] font-bold uppercase mb-3.5"
            style={{ letterSpacing: '0.22em', color: 'rgba(255,255,255,0.6)' }}
          >
            Solves · Assets
          </div>
          <h1
            className="font-extrabold mb-4"
            style={{
              fontSize: 44,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
            }}
          >
            Nameplates<br />in, spreadsheet<br />out.
          </h1>
          <p
            className="max-w-[440px] text-[15px]"
            style={{ lineHeight: 1.55, color: 'rgba(255,255,255,0.75)' }}
          >
            Capture electrical asset data with your phone, on-site and offline.
            Sync back to the office the moment you're in range.
          </p>
        </div>

        <div
          className="relative z-10 text-[11px]"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          © {new Date().getFullYear()} EQ Solutions
        </div>
      </div>

      {/* ── Right: PIN pad ─────────────────────────────────────── */}
      <div className="flex flex-col justify-center px-14 py-[60px]">
        <Eyebrow>Crew sign-in</Eyebrow>
        <h2
          className="text-ink font-bold mt-1.5 mb-1"
          style={{ fontSize: 28, letterSpacing: '-0.015em' }}
        >
          Enter job PIN
        </h2>
        <p className="text-[13px] text-muted mb-7">
          Ask the office for today's 4-digit code.
        </p>

        {/* PIN slots */}
        <div className="flex gap-3 mb-7">
          {[0, 1, 2, 3].map((i) => {
            const filled = i < pin.length
            const borderColor = isError
              ? '#DC2626'
              : filled
                ? '#2986B4'
                : '#D1D5DB'
            return (
              <div
                key={i}
                className="flex-1 h-14 rounded-lg flex items-center justify-center transition-all duration-150"
                style={{
                  background: filled ? '#EAF5FB' : '#FFFFFF',
                  border: `1.5px solid ${borderColor}`,
                }}
              >
                {filled && (
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      background: isError ? '#DC2626' : '#2986B4',
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Keypad */}
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: 320 }}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <PinKey key={n} onClick={() => push(String(n))} disabled={locked || checking}>
              {n}
            </PinKey>
          ))}
          <div />
          <PinKey onClick={() => push('0')} disabled={locked || checking}>
            0
          </PinKey>
          <PinKey onClick={back} disabled={locked || checking} aria-label="Backspace">
            <Delete size={18} strokeWidth={2} />
          </PinKey>
        </div>

        {/* Status row */}
        <div className="mt-6 min-h-[20px] text-[12px]">
          {checking && <span className="text-muted">Checking…</span>}
          {!checking && locked && (
            <span className="text-warn-fg font-semibold">
              {error} <span className="font-mono">({cooldownRemaining}s)</span>
            </span>
          )}
          {!checking && !locked && error && (
            <span className="text-bad-fg font-semibold">{error}</span>
          )}
          {!checking && !locked && !error && (
            <span className="text-muted">
              Trouble signing in?{' '}
              <button
                onClick={() => navigate('/')}
                className="text-sky-deep font-semibold hover:underline"
              >
                Go home →
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function PinKey({
  children,
  onClick,
  disabled,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-14 rounded-lg text-[20px] font-semibold text-ink bg-white border border-gray-200 transition-colors duration-[80ms] flex items-center justify-center hover:bg-ice hover:border-sky-deep active:bg-ice focus:outline-none focus-visible:shadow-focus disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}
