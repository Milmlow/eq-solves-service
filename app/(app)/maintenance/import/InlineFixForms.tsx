'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import {
  createAssetFromRowAction,
  createJobPlanFromImportAction,
} from './fix-actions'

// ── Create Asset (per row) ──────────────────────────────────────────────

interface CreateAssetProps {
  onClose: () => void
  importSessionId: string
  rowNumber: number
  siteId: string | null
  siteName: string | null
  /** Defaults seeded from the sheet row. */
  defaults: {
    maximoId: string
    description: string
    location: string | null
  }
  onCreated: (assetId: string) => void
}

/**
 * Minimum viable new-asset form for use during import. Seeds maximo_id,
 * location, and name from the sheet so the user usually only confirms the
 * asset_type. The server action enforces the full `CreateAssetSchema`.
 */
export function CreateAssetDialog({
  onClose,
  importSessionId,
  rowNumber,
  siteId,
  siteName,
  defaults,
  onCreated,
}: CreateAssetProps) {
  const [name, setName] = useState(defaults.description || defaults.maximoId)
  const [assetType, setAssetType] = useState('CB')
  const [maximoId, setMaximoId] = useState(defaults.maximoId)
  const [location, setLocation] = useState(defaults.location ?? '')
  const [manufacturer, setManufacturer] = useState('')
  const [model, setModel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (!siteId) {
      setErr('Site could not be resolved. Create the site first.')
      return
    }
    setErr(null)
    startTransition(async () => {
      const r = await createAssetFromRowAction({
        importSessionId,
        rowNumber,
        asset: {
          site_id: siteId,
          name: name.trim(),
          asset_type: assetType.trim(),
          maximo_id: maximoId.trim() || null,
          location: location.trim() || null,
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
        },
      })
      if (!r.success) {
        setErr(r.error)
        return
      }
      onCreated(r.data!.assetId)
    })
  }

  return (
    <Modal open={true} onClose={onClose} title={`Create asset (row ${rowNumber})`}>
      <div className="space-y-3">
        {siteName && (
          <p className="text-xs text-eq-grey">
            At <span className="font-medium text-eq-ink">{siteName}</span>
          </p>
        )}

        <FormInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Asset name or tag"
          required
        />
        <FormInput
          label="Asset type"
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
          placeholder="CB, MCCB, ACB, …"
          required
        />
        <FormInput
          label="Maximo ID"
          value={maximoId}
          onChange={(e) => setMaximoId(e.target.value)}
        />
        <FormInput
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <FormInput
            label="Manufacturer"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
          />
          <FormInput
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={isPending || !name.trim() || !assetType.trim()}>
            {isPending ? 'Creating…' : 'Create asset'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Create Job Plan (per group) ─────────────────────────────────────────

interface CreateJobPlanProps {
  onClose: () => void
  importSessionId: string
  groupKey: string
  defaults: {
    code: string
    name: string
  }
  onCreated: (jobPlanId: string) => void
}

/**
 * Minimal inline new-job-plan form. Code comes from the sheet; a name is
 * required. We leave type/description/frequency blank by design — this is
 * a fast "unblock the import" flow, not a full plan builder.
 */
export function CreateJobPlanDialog({
  onClose,
  importSessionId,
  groupKey,
  defaults,
  onCreated,
}: CreateJobPlanProps) {
  const [code, setCode] = useState(defaults.code)
  const [name, setName] = useState(defaults.name)
  const [type, setType] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setErr(null)
    startTransition(async () => {
      const r = await createJobPlanFromImportAction({
        importSessionId,
        groupKey,
        jobPlan: {
          site_id: null,
          code: code.trim() || null,
          name: name.trim(),
          type: type.trim() || null,
        },
      })
      if (!r.success) {
        setErr(r.error)
        return
      }
      onCreated(r.data!.jobPlanId)
    })
  }

  return (
    <Modal open={true} onClose={onClose} title="Create job plan">
      <div className="space-y-3">
        <p className="text-xs text-eq-grey">
          Creates a tenant-scoped job plan so this group can be imported. You can
          flesh out items, frequencies, and type in Job Plans after the import.
        </p>

        <FormInput
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. E1.25"
          required
        />
        <FormInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Human-readable name"
          required
        />
        <FormInput
          label="Type (optional)"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="e.g. Low Voltage Air Circuit Breaker"
        />

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={isPending || !name.trim() || !code.trim()}
          >
            {isPending ? 'Creating…' : 'Create job plan'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
