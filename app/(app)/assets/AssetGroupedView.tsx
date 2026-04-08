'use client'

import { useState, useMemo } from 'react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/utils/cn'
import { ChevronDown, ChevronRight, MapPin, Layers, FileText } from 'lucide-react'
import type { Asset, JobPlan } from '@/lib/types'

interface AssetWithSite extends Asset {
  sites: { name: string } | null
  job_plans: { name: string; code: string | null } | null
}

interface AssetGroupedViewProps {
  assets: AssetWithSite[]
  onAssetClick: (asset: AssetWithSite) => void
}

interface GroupNode {
  label: string
  count: number
  children?: GroupNode[]
  assets?: AssetWithSite[]
}

export function AssetGroupedView({ assets, onAssetClick }: AssetGroupedViewProps) {
  const tree = useMemo(() => {
    // Group: Site > Location > Job Plan
    const siteMap = new Map<string, AssetWithSite[]>()
    for (const asset of assets) {
      const siteName = asset.sites?.name ?? 'Unassigned'
      if (!siteMap.has(siteName)) siteMap.set(siteName, [])
      siteMap.get(siteName)!.push(asset)
    }

    const siteNodes: GroupNode[] = []
    for (const [siteName, siteAssets] of Array.from(siteMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      // Group by location
      const locMap = new Map<string, AssetWithSite[]>()
      for (const asset of siteAssets) {
        const loc = asset.location?.trim() || 'No Location'
        if (!locMap.has(loc)) locMap.set(loc, [])
        locMap.get(loc)!.push(asset)
      }

      const locNodes: GroupNode[] = []
      for (const [locName, locAssets] of Array.from(locMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        // Group by job plan
        const jpMap = new Map<string, AssetWithSite[]>()
        for (const asset of locAssets) {
          const jp = asset.job_plans?.name ?? 'No Job Plan'
          if (!jpMap.has(jp)) jpMap.set(jp, [])
          jpMap.get(jp)!.push(asset)
        }

        const jpNodes: GroupNode[] = []
        for (const [jpName, jpAssets] of Array.from(jpMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
          jpNodes.push({ label: jpName, count: jpAssets.length, assets: jpAssets })
        }

        locNodes.push({ label: locName, count: locAssets.length, children: jpNodes })
      }

      siteNodes.push({ label: siteName, count: siteAssets.length, children: locNodes })
    }

    return siteNodes
  }, [assets])

  if (assets.length === 0) return null

  return (
    <div className="space-y-2">
      {tree.map((site) => (
        <SiteGroup key={site.label} node={site} onAssetClick={onAssetClick} />
      ))}
    </div>
  )
}

function SiteGroup({ node, onAssetClick }: { node: GroupNode; onAssetClick: (a: AssetWithSite) => void }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-eq-ice hover:bg-eq-ice/80 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-eq-deep" /> : <ChevronRight className="w-4 h-4 text-eq-deep" />}
        <MapPin className="w-4 h-4 text-eq-sky" />
        <span className="font-semibold text-eq-deep">{node.label}</span>
        <span className="text-xs text-eq-grey ml-auto">{node.count} asset{node.count !== 1 ? 's' : ''}</span>
      </button>
      {open && node.children && (
        <div className="pl-4">
          {node.children.map((loc) => (
            <LocationGroup key={loc.label} node={loc} onAssetClick={onAssetClick} />
          ))}
        </div>
      )}
    </div>
  )
}

function LocationGroup({ node, onAssetClick }: { node: GroupNode; onAssetClick: (a: AssetWithSite) => void }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-eq-grey" /> : <ChevronRight className="w-3.5 h-3.5 text-eq-grey" />}
        <Layers className="w-3.5 h-3.5 text-eq-grey" />
        <span className="font-medium text-eq-ink text-sm">{node.label}</span>
        <span className="text-xs text-eq-grey ml-auto">{node.count}</span>
      </button>
      {open && node.children && (
        <div className="pl-4">
          {node.children.map((jp) => (
            <JobPlanGroup key={jp.label} node={jp} onAssetClick={onAssetClick} />
          ))}
        </div>
      )}
    </div>
  )
}

function JobPlanGroup({ node, onAssetClick }: { node: GroupNode; onAssetClick: (a: AssetWithSite) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-gray-50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 text-eq-grey" /> : <ChevronRight className="w-3 h-3 text-eq-grey" />}
        <FileText className="w-3 h-3 text-eq-grey" />
        <span className="text-sm text-eq-ink">{node.label}</span>
        <span className="text-xs text-eq-grey ml-auto">{node.count}</span>
      </button>
      {open && node.assets && (
        <div className="px-4 pb-2">
          <div className="grid gap-1.5">
            {node.assets.map((asset) => (
              <button
                key={asset.id}
                onClick={() => onAssetClick(asset)}
                className="flex items-center gap-3 px-3 py-2 rounded bg-gray-50 hover:bg-eq-ice/50 transition-colors text-left text-sm"
              >
                <span className="font-mono text-xs text-eq-grey w-24 shrink-0">{asset.maximo_id ?? '—'}</span>
                <span className="font-medium text-eq-ink truncate flex-1">{asset.name}</span>
                <span className="text-xs text-eq-grey shrink-0">{asset.asset_type}</span>
                <StatusBadge status={asset.is_active ? 'active' : 'inactive'} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
