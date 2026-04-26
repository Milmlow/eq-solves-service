import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../lib/router'
import { useAssets, useFields, useJob } from '../hooks/useJobData'
import { useCapturer } from '../hooks/useCapturer'
import { subscribeQueue } from '../lib/queue'
import { AssetList } from './jobscreen/AssetList'
import { AssetCapture } from './jobscreen/AssetCapture'
import { PasteBatchModal } from '../components/PasteBatchModal'

type Props = {
  jobRef: string
  assetId?: string | null
}

/**
 * Master-detail JobScreen page: 360px AssetList pane (left) + 1fr AssetCapture
 * pane (right). Lives inside AppShell so the sidebar/topbar remain.
 */
export function JobScreenPage({ jobRef, assetId }: Props) {
  const { job, loading: jobLoading } = useJob(jobRef)
  const jobId = job?.id ?? null
  const { assets: assetsRaw, loading: assetsLoading } = useAssets(jobId)
  const { fields } = useFields(job?.classification_code ?? null)
  const { name: capturerName } = useCapturer()

  // Re-render whenever the queue changes so progress rings + counts stay live.
  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick((v) => v + 1)), [])

  // Walking order: group by location_description (alphabetical, empty last),
  // then row_number within a group. Matches how a tech physically walks the
  // switchroom — same order in the list, Prev/Next, and any exports.
  const assets = useMemo(() => {
    return [...assetsRaw].sort((a, b) => {
      const la = a.location_description ?? ''
      const lb = b.location_description ?? ''
      if (la === '' && lb !== '') return 1
      if (lb === '' && la !== '') return -1
      if (la !== lb) return la.localeCompare(lb)
      return (a.row_number ?? 0) - (b.row_number ?? 0)
    })
  }, [assetsRaw])

  // Pick an active asset: URL param if present + valid, else first incomplete,
  // else first asset.
  const activeAsset = useMemo(() => {
    if (!assets.length) return null
    if (assetId) {
      const match = assets.find((a) => a.id === assetId)
      if (match) return match
    }
    return assets[0]
  }, [assets, assetId])

  // Keep URL in sync with active selection so refresh + back-button work.
  useEffect(() => {
    if (!job) return
    if (!activeAsset) return
    const desired = `/j/${job.slug ?? job.id}/a/${activeAsset.id}`
    const current = window.location.hash.replace(/^#/, '')
    if (current !== desired) {
      // Replace — don't pollute history when we're just auto-selecting.
      window.location.replace(`#${desired}`)
    }
  }, [job, activeAsset])

  const onSelectAsset = (id: string) => {
    if (!job) return
    navigate(`/j/${job.slug ?? job.id}/a/${id}`)
  }

  // Paste-batch modal — open via AssetList footer button
  const [pasteOpen, setPasteOpen] = useState(false)

  if (jobLoading && !job) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-muted">
        Loading job…
      </div>
    )
  }

  if (!job) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-muted">
        Job not found.
      </div>
    )
  }

  return (
    <div
      className="grid bg-white border border-border rounded-xl overflow-hidden"
      style={{
        gridTemplateColumns: '360px minmax(0,1fr)',
        height: 'calc(100vh - 56px - 48px)',
      }}
    >
      <AssetList
        jobId={job.id}
        assets={assets}
        fields={fields}
        activeAssetId={activeAsset?.id ?? null}
        capturerName={capturerName}
        onSelectAsset={onSelectAsset}
        onOpenMatrix={() => navigate(`/j/${job.slug ?? job.id}/admin`)}
        onOpenExport={() => navigate(`/j/${job.slug ?? job.id}/export`)}
        onOpenPasteBatch={() => setPasteOpen(true)}
      />
      {assetsLoading && assets.length === 0 ? (
        <div className="flex items-center justify-center text-[13px] text-muted">
          Loading assets…
        </div>
      ) : (
        <AssetCapture
          jobId={job.id}
          asset={activeAsset}
          assets={assets}
          fields={fields}
          capturerName={capturerName}
          onNavigateAsset={onSelectAsset}
        />
      )}
      {pasteOpen && (
        <PasteBatchModal
          jobId={job.id}
          assets={assets}
          fields={fields}
          capturerName={capturerName}
          onClose={() => setPasteOpen(false)}
        />
      )}
    </div>
  )
}
