import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Asset, Job } from '../types/db'
import { allCaptures, subscribeQueue } from '../lib/queue'

export type JobRow = {
  job: Job
  total: number            // total assets
  done: number             // assets with at least one capture
  pending: number          // unsynced captures for this job
  flagged: number          // flagged captures (synced or not) for this job
  updatedAt: string | null // most recent capture timestamp (local + server)
}

const CACHE_KEY = 'eq-cache-v1:dashboard:'

function cacheGet<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY + k)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function cacheSet(k: string, v: unknown) {
  try {
    localStorage.setItem(CACHE_KEY + k, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

/**
 * Fetches jobs + aggregates asset + capture counts for the Dashboard.
 * One query each (no N+1). Pending is computed locally from the offline
 * queue so it reacts to capture events immediately.
 */
export function useJobsDashboard() {
  const [jobs, setJobs] = useState<Job[]>(() => cacheGet<Job[]>('jobs') ?? [])
  const [assets, setAssets] = useState<Asset[]>(() => cacheGet<Asset[]>('assets') ?? [])
  const [serverCaptures, setServerCaptures] = useState<Array<{
    asset_id: string
    flagged: boolean | null
    captured_at: string
  }>>(() => cacheGet('captures') ?? [])
  const [loading, setLoading] = useState(!jobs.length)
  const [error, setError] = useState<string | null>(null)
  const [queueVersion, setQueueVersion] = useState(0)

  // React to local queue writes (new captures, sync success)
  useEffect(() => subscribeQueue(() => setQueueVersion(v => v + 1)), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [jobsRes, assetsRes, capturesRes] = await Promise.all([
          supabase.from('jobs').select('*').order('created_at', { ascending: false }),
          supabase.from('assets').select('id,job_id'),
          supabase.from('captures').select('asset_id,flagged,captured_at'),
        ])
        if (cancelled) return
        if (jobsRes.error) throw jobsRes.error
        if (assetsRes.error) throw assetsRes.error
        if (capturesRes.error) throw capturesRes.error

        const js = (jobsRes.data ?? []) as Job[]
        const as = (assetsRes.data ?? []) as Asset[]
        const cs = (capturesRes.data ?? []) as Array<{
          asset_id: string
          flagged: boolean | null
          captured_at: string
        }>
        setJobs(js)
        setAssets(as)
        setServerCaptures(cs)
        cacheSet('jobs', js)
        cacheSet('assets', as)
        cacheSet('captures', cs)
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        // Keep cached data visible; only set error banner
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<JobRow[]>(() => {
    // Force recomputation when queue changes
    void queueVersion

    const local = allCaptures()
    const assetsByJob = new Map<string, string[]>()
    for (const a of assets) {
      const list = assetsByJob.get(a.job_id) ?? []
      list.push(a.id)
      assetsByJob.set(a.job_id, list)
    }

    // Captured asset set: union of server + local queue
    const capturedByJob = new Map<string, Set<string>>()
    const flaggedByJob = new Map<string, number>()
    const pendingByJob = new Map<string, number>()
    const latestByJob = new Map<string, string>()

    for (const c of serverCaptures) {
      for (const [jobId, ids] of assetsByJob) {
        if (ids.includes(c.asset_id)) {
          const s = capturedByJob.get(jobId) ?? new Set<string>()
          s.add(c.asset_id)
          capturedByJob.set(jobId, s)
          if (c.flagged) flaggedByJob.set(jobId, (flaggedByJob.get(jobId) ?? 0) + 1)
          const prev = latestByJob.get(jobId)
          if (!prev || c.captured_at > prev) latestByJob.set(jobId, c.captured_at)
        }
      }
    }

    for (const c of local) {
      const s = capturedByJob.get(c.jobId) ?? new Set<string>()
      s.add(c.assetId)
      capturedByJob.set(c.jobId, s)
      if (c.flagged) flaggedByJob.set(c.jobId, (flaggedByJob.get(c.jobId) ?? 0) + 1)
      if (!c.synced) pendingByJob.set(c.jobId, (pendingByJob.get(c.jobId) ?? 0) + 1)
      const prev = latestByJob.get(c.jobId)
      if (!prev || c.capturedAt > prev) latestByJob.set(c.jobId, c.capturedAt)
    }

    return jobs.map<JobRow>(job => {
      const total = assetsByJob.get(job.id)?.length ?? 0
      const done = capturedByJob.get(job.id)?.size ?? 0
      return {
        job,
        total,
        done,
        pending: pendingByJob.get(job.id) ?? 0,
        flagged: flaggedByJob.get(job.id) ?? 0,
        updatedAt: latestByJob.get(job.id) ?? null,
      }
    })
  }, [jobs, assets, serverCaptures, queueVersion])

  const totals = useMemo(() => {
    const activeJobs = rows.filter(r => r.job.active && r.done < r.total).length
    const capturedAssets = rows.reduce((sum, r) => sum + r.done, 0)
    const pendingSync = rows.reduce((sum, r) => sum + r.pending, 0)
    const flagged = rows.reduce((sum, r) => sum + r.flagged, 0)
    return { activeJobs, capturedAssets, pendingSync, flagged }
  }, [rows])

  return { rows, totals, loading, error }
}
