import { useEffect, useState } from 'react'
import { fetchPinRequired, hasPinPass, PinGate } from './PinGate'
import { useJob } from '../hooks/useJobData'

interface Props {
  jobRef: string
  children: React.ReactNode
}

export function JobGuard({ jobRef, children }: Props) {
  const { job, loading: jobLoading, error: jobError } = useJob(jobRef)
  const jobId = job?.id ?? null
  const [state, setState] = useState<'checking' | 'open' | 'need-pin' | 'passed'>('checking')

  useEffect(() => {
    if (!jobId) return
    if (hasPinPass(jobId)) {
      setState('passed')
      return
    }
    let cancelled = false
    ;(async () => {
      const required = await fetchPinRequired(jobId)
      if (cancelled) return
      if (!required) setState('open')
      else setState('need-pin')
    })()
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (jobError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <div className="text-bad font-bold mb-2">Can't open this job</div>
        <div className="text-sm text-muted mb-4">{jobError}</div>
      </div>
    )
  }

  if (jobLoading || !jobId || state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted">
        Checking access…
      </div>
    )
  }

  if (state === 'need-pin') {
    return <PinGate jobId={jobId} onPass={() => setState('passed')} />
  }

  return <>{children}</>
}
