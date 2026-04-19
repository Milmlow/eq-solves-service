'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Search, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { searchAssetsAction, type AssetSearchHit } from './fix-actions'

interface Props {
  onClose: () => void
  /** Tenant-scoped site the asset must belong to. */
  siteId: string | null
  /** Name of the site (display only). */
  siteName: string | null
  /** Pre-seed the search with the original maximo_id so the first type is usually zero chars. */
  initialQuery?: string
  onPick: (asset: AssetSearchHit) => void
}

/**
 * Debounced site-scoped asset search. Returns the top 10 matches by name,
 * maximo_id, or location (PostgREST ilike OR). Callers can preseed the
 * query with the row's maximo_id so the wizard nudges them toward the
 * closest candidate without re-typing.
 *
 * Always rendered conditionally by the parent (`{open && <AssetPicker …/>}`)
 * so each open is a fresh mount — keeps state init pure and avoids the
 * setState-in-effect anti-pattern.
 */
export function AssetPicker({
  onClose,
  siteId,
  siteName,
  initialQuery = '',
  onPick,
}: Props) {
  const [q, setQ] = useState(initialQuery)
  const [hits, setHits] = useState<AssetSearchHit[]>([])
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus on mount — once. Cheap, and the input ref is stable.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Debounced search
  useEffect(() => {
    if (!siteId) return
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await searchAssetsAction({
          siteId,
          query: q.trim(),
          limit: 10,
        })
        if (!result.success) {
          setErr(result.error)
          setHits([])
          return
        }
        setErr(null)
        setHits(result.data ?? [])
      })
    }, 220)
    return () => clearTimeout(handle)
  }, [q, siteId])

  return (
    <Modal open={true} onClose={onClose} title="Link to existing EQ asset">
      <div className="space-y-3">
        {siteName && (
          <p className="text-xs text-eq-grey">
            Searching assets at <span className="font-medium text-eq-ink">{siteName}</span>
          </p>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-eq-grey" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, Maximo ID, or location…"
            className="w-full border border-gray-200 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-eq-sky focus:ring-1 focus:ring-eq-sky"
          />
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}

        {!siteId && (
          <p className="text-xs text-amber-700">
            This row&apos;s site could not be resolved, so asset search is disabled. Create the
            site in Sites first, then re-parse.
          </p>
        )}

        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-h-72 overflow-auto">
          {isPending && hits.length === 0 && (
            <li className="px-3 py-2 text-xs text-eq-grey">Searching…</li>
          )}
          {!isPending && hits.length === 0 && (
            <li className="px-3 py-2 text-xs text-eq-grey">
              {q ? 'No assets match.' : 'Start typing to search, or leave blank for top 10.'}
            </li>
          )}
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onPick(h)}
                className="w-full text-left px-3 py-2 hover:bg-eq-ice transition-colors"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-eq-sky shrink-0" />
                  <span className="text-sm font-medium text-eq-ink">{h.name}</span>
                  {h.asset_type && (
                    <span className="text-[10px] uppercase tracking-wide text-eq-grey">
                      {h.asset_type}
                    </span>
                  )}
                </div>
                <div className="text-xs text-eq-grey mt-0.5 flex gap-3">
                  {h.maximo_id && (
                    <span>
                      Maximo: <span className="font-mono">{h.maximo_id}</span>
                    </span>
                  )}
                  {h.location && <span>{h.location}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
