import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { EqMark } from './EqMark'
import { navigate } from '../lib/router'

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
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  useEffect(() => {
    refs[0].current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick while cooling down so the countdown updates
  useEffect(() => {
    if (cooldownUntil <= now) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [cooldownUntil, now])

  const cooldownRemaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const locked = cooldownRemaining > 0

  const setDigit = (i: number, v: string) => {
    if (locked) return
    const clean = v.replace(/\D/g, '').slice(0, 1)
    const next = [...digits]
    next[i] = clean
    setDigits(next)
    setError(null)
    if (clean && i < 3) refs[i + 1].current?.focus()
    if (next.every((d) => d !== '')) {
      void submit(next.join(''))
    }
  }

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs[i - 1].current?.focus()
    }
  }

  const submit = async (pin: string) => {
    if (locked) return
    setChecking(true)
    const ok = await verifyPin(jobId, pin)
    setChecking(false)
    if (ok) {
      grantPinPass(jobId)
      onPass()
      return
    }
    const newAttempts = attempts + 1
    setAttempts(newAttempts)
    setDigits(['', '', '', ''])

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
      setError('Wrong PIN. Check with the office.')
      refs[0].current?.focus()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex mb-4">
            <EqMark size={40} />
          </div>
          <h1 className="text-2xl font-bold text-ink mb-1">Job PIN</h1>
          <p className="text-sm text-muted">Ask the office for today's 4-digit code.</p>
        </div>
        <div className="card p-6">
          <div className="flex gap-3 justify-center mb-3">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={refs[i]}
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                disabled={checking || locked}
                className="w-14 h-16 rounded-xl border-2 border-border bg-white text-ink text-center text-2xl font-bold mono focus:border-sky focus:ring-2 focus:ring-sky/20 outline-none disabled:opacity-50"
                aria-label={`PIN digit ${i + 1}`}
              />
            ))}
          </div>
          {locked ? (
            <div className="text-center text-sm text-warn font-semibold">
              {error} <span className="mono">({cooldownRemaining}s)</span>
            </div>
          ) : error ? (
            <div className="text-center text-sm text-bad font-semibold">{error}</div>
          ) : null}
          {checking ? <div className="text-center text-sm text-muted">Checking…</div> : null}
        </div>
        <div className="mt-4 text-center">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-muted hover:text-ink underline underline-offset-2"
          >
            Wrong link? Go home
          </button>
        </div>
      </div>
    </div>
  )
}
