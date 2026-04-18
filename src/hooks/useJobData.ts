import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Asset, ClassificationField, Job, Site } from '../types/db'
import { capturesForAsset, subscribeQueue, allCaptures } from '../lib/queue'

const CACHE_KEY_PREFIX = 'eq-cache-v1:'

function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function cacheSet(key: string, value: unknown) {
  localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(value))
}

// ----------------------------------------------------------------------------

export function useJob(jobRef: string | null) {
  const cached = jobRef ? cacheGet<Job>(`job:${jobRef}`) : null
  const [job, setJob] = useState<Job | null>(cached)
  const [loading, setLoading] = useState(!job)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobRef) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // Accept either UUID or slug. If it looks like a UUID, match by id;
      // otherwise match by slug.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobRef)
      const query = isUuid
        ? supabase.from('jobs').select('*').eq('id', jobRef).maybeSingle()
        : supabase.from('jobs').select('*').eq('slug', jobRef).maybeSingle()
      const { data, error } = await query
      if (cancelled) return
      if (error) {
        setError(error.message)
      } else if (data) {
        setJob(data as Job)
        // Cache under BOTH lookup keys so the next visit is instant
        cacheSet(`job:${(data as Job).id}`, data)
        if ((data as any).slug) cacheSet(`job:${(data as any).slug}`, data)
      } else {
        setError('Job not found')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [jobRef])

  return { job, loading, error }
}

export function useAssets(jobId: string | null) {
  const [assets, setAssets] = useState<Asset[]>(() =>
    jobId ? cacheGet<Asset[]>(`assets:${jobId}`) ?? [] : [],
  )
  const [loading, setLoading] = useState(!assets.length)

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('job_id', jobId)
        .order('row_number')
      if (cancelled) return
      if (!error && data) {
        setAssets(data as Asset[])
        cacheSet(`assets:${jobId}`, data)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [jobId])

  return { assets, loading }
}

export function useFields(classificationCode: string | null) {
  const [fields, setFields] = useState<ClassificationField[]>(() =>
    classificationCode ? cacheGet<ClassificationField[]>(`fields:${classificationCode}`) ?? [] : [],
  )
  const [loading, setLoading] = useState(!fields.length)

  useEffect(() => {
    if (!classificationCode) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('classification_fields')
        .select('*')
        .eq('classification_code', classificationCode)
        .order('display_order')
      if (cancelled) return
      if (!error && data) {
        // Align the server field_group / field_group alias to our local type
        const normalised = (data as unknown[]).map((row: any) => ({
          ...row,
          group: row.field_group ?? row.group ?? null,
        })) as ClassificationField[]
        setFields(normalised)
        cacheSet(`fields:${classificationCode}`, normalised)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [classificationCode])

  return { fields, loading }
}

// Asset captures: merges server captures with local queue state
export function useAssetCaptures(assetId: string | null) {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeQueue(() => setVersion((v) => v + 1)), [])

  if (!assetId) return { values: {} as Record<number, string | null> }
  const local = capturesForAsset(assetId)
  const values: Record<number, string | null> = {}
  for (const c of local) values[c.classificationFieldId] = c.value
  // `version` read to trigger re-renders on queue changes
  void version
  return { values }
}

// Global counter of pending (unsynced) captures for a given job
export function usePendingForJob(jobId: string | null, assetIds: string[]): number {
  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick((v) => v + 1)), [])
  if (!jobId) return 0
  const set = new Set(assetIds)
  return allCaptures().filter((c) => !c.synced && set.has(c.assetId)).length
}

// ----------------------------------------------------------------------------
// Site info (drawings + contacts) — keyed by site_code, shared across jobs.

export function useSite(siteCode: string | null) {
  const cached = siteCode ? cacheGet<Site>(`site:${siteCode}`) : null
  const [site, setSite] = useState<Site | null>(cached)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    if (!siteCode) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('sites')
        .select('*')
        .eq('site_code', siteCode)
        .maybeSingle()
      if (cancelled) return
      if (data) {
        setSite(data as Site)
        cacheSet(`site:${siteCode}`, data)
      } else {
        setSite(null)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [siteCode])

  return { site, loading }
}
