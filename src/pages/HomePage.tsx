import { useEffect, useState } from 'react'
import { navigate } from '../lib/router'
import { EqLockup, EqMark } from '../components/EqMark'
import { SiteInfoSheet } from '../components/SiteInfoSheet'
import { supabase } from '../lib/supabase'
import { CAPTURED_BY_KEY, signOut } from '../lib/constants'
import { versionLabel } from '../lib/version'

interface JobRow {
  id: string
  slug: string | null
  site_code: string
  classification_code: string
  name: string | null
}

export function HomePage() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null)
  const [capturedBy, setCapturedBy] = useState<string | null>(null)
  const [siteInfoCode, setSiteInfoCode] = useState<string | null>(null)

  useEffect(() => {
    setCapturedBy(localStorage.getItem(CAPTURED_BY_KEY))
    void (async () => {
      const { data } = await supabase
        .from('jobs_public')
        .select('id, slug, site_code, classification_code, name')
        .order('created_at', { ascending: false })
        .limit(20)
      setJobs((data as JobRow[]) ?? [])
    })()
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 px-6 py-10">
        <div className="max-w-sm mx-auto w-full">
          <div className="text-center mb-7">
            <div className="inline-flex mb-4">
              <EqLockup size={40} productLabel="Asset Capture" />
            </div>
            <h1 className="text-xl font-bold text-ink mb-1.5">Pick your job</h1>
            <p className="text-sm text-muted">
              Your site lead will have shared a direct link — or tap a job below.
              {capturedBy ? (
                <span className="block text-xs mt-1">
                  Signed in as <span className="font-semibold text-ink">{capturedBy}</span>
                </span>
              ) : null}
            </p>
          </div>

          {/* Active jobs from Supabase */}
          <div className="space-y-2">
            {jobs === null ? (
              <div className="card p-4 text-sm text-muted text-center">Loading jobs…</div>
            ) : jobs.length === 0 ? (
              <div className="card p-4 text-sm text-muted text-center">
                No active jobs. Check with the office.
              </div>
            ) : (
              jobs.map((j) => {
                const ref = j.slug ?? j.id
                const label = j.name ?? `${j.site_code} ${j.classification_code}`
                return (
                  <div
                    key={j.id}
                    className="card p-3.5 flex items-center gap-3 hover:border-sky/60 transition"
                  >
                    <button
                      onClick={() => setSiteInfoCode(j.site_code)}
                      className="w-9 h-9 rounded-lg bg-sky-soft flex items-center justify-center text-sky-deep text-xs font-bold hover:bg-sky/20 active:scale-95 transition"
                      title="Site info"
                      aria-label="Site info"
                    >
                      {j.site_code.slice(0, 3)}
                    </button>
                    <button
                      onClick={() => navigate(`/j/${ref}`)}
                      className="flex-1 min-w-0 text-left active:opacity-70"
                    >
                      <div className="font-semibold text-ink truncate">{label}</div>
                      <div className="text-xs text-muted mono truncate">/j/{ref}</div>
                    </button>
                    <button
                      onClick={() => navigate(`/j/${ref}`)}
                      className="p-1 -mr-1"
                      aria-label="Open job"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Office utilities — pushed down, visually de-emphasised */}
          <div className="mt-8 pt-5 border-t border-border/60 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted text-center mb-2">
              For the office
            </div>
            <button
              onClick={() => navigate('/import')}
              className="btn btn-ghost btn-md w-full justify-start"
            >
              <span className="mr-2">📋</span> Import a new template
            </button>
            <button
              onClick={() => navigate('/debug')}
              className="btn btn-ghost btn-md w-full justify-start"
            >
              <span className="mr-2">🔧</span> Run self-check
            </button>
            {capturedBy ? (
              <button
                onClick={() => {
                  if (!confirm(`Sign out as ${capturedBy}? You can re-enter your name on the next job.`)) return
                  signOut()
                  setCapturedBy(null)
                }}
                className="btn btn-ghost btn-md w-full justify-start text-bad"
              >
                <span className="mr-2">🚪</span> Sign out ({capturedBy})
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="safe-bottom py-4 flex items-center justify-center gap-1.5 text-xs text-muted">
        <EqMark size={14} aria-hidden />
        <span>EQ Solutions</span>
        <span className="mono text-[10px]">· {versionLabel()}</span>
      </div>

      {siteInfoCode ? (
        <SiteInfoSheet siteCode={siteInfoCode} onClose={() => setSiteInfoCode(null)} />
      ) : null}
    </div>
  )
}
