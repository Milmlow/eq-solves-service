'use client'

/**
 * NSX Workflow — 3-step framework mirroring ACB workflow.
 *
 * Framework stub: Step 1 Asset Collection, Step 2 Visual & Functional,
 * Step 3 Electrical Testing. The field set is currently a subset of ACB
 * and is intended to be expanded/amended after review.
 */

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { CheckCircle2, Clock, ClipboardList, Wrench, Zap } from 'lucide-react'
import type { NsxTest } from '@/lib/types'
import { updateNsxDetailsAction } from '@/app/(app)/nsx-testing/actions'

type StepKey = 'step1' | 'step2' | 'step3'
type StepStatus = 'pending' | 'in_progress' | 'complete'

interface NsxWorkflowProps {
  test: NsxTest
  onUpdate: () => void | Promise<void>
}

const STEPS: { key: StepKey; label: string; icon: typeof ClipboardList }[] = [
  { key: 'step1', label: 'Asset Collection', icon: ClipboardList },
  { key: 'step2', label: 'Visual & Functional', icon: Wrench },
  { key: 'step3', label: 'Electrical Testing', icon: Zap },
]

function stepStatus(test: NsxTest, step: StepKey): StepStatus {
  return test[`${step}_status`] as StepStatus
}

function StatusPill({ status }: { status: StepStatus }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle2 className="w-3 h-3" /> Complete
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
        <Clock className="w-3 h-3" /> In Progress
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Not Started
    </span>
  )
}

export function NsxWorkflow({ test, onUpdate }: NsxWorkflowProps) {
  const [activeStep, setActiveStep] = useState<StepKey>('step2')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save(data: Parameters<typeof updateNsxDetailsAction>[1]) {
    setError(null)
    startTransition(async () => {
      const res = await updateNsxDetailsAction(test.id, data)
      if (!res.success) setError(res.error ?? 'Save failed.')
      else await onUpdate()
    })
  }

  function markStepComplete(step: StepKey) {
    save({ [`${step}_status`]: 'complete' } as Parameters<typeof updateNsxDetailsAction>[1])
  }

  return (
    <div className="space-y-6">
      {/* Step selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STEPS.map((s) => {
          const status = stepStatus(test, s.key)
          const active = activeStep === s.key
          const Icon = s.icon
          return (
            <button
              key={s.key}
              onClick={() => setActiveStep(s.key)}
              className={`text-left p-4 rounded-lg border transition-all ${
                active
                  ? 'border-eq-sky bg-eq-ice/40 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-eq-sky/50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${active ? 'text-eq-sky' : 'text-eq-grey'}`} />
                  <span className={`text-sm font-semibold ${active ? 'text-eq-sky' : 'text-eq-ink'}`}>
                    {s.label}
                  </span>
                </div>
                <StatusPill status={status} />
              </div>
              <p className="text-xs text-eq-grey">Step {s.key.slice(-1)}</p>
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Step bodies */}
      {activeStep === 'step1' && <Step1AssetCollection test={test} onSave={save} onMarkComplete={() => markStepComplete('step1')} pending={pending} />}
      {activeStep === 'step2' && <Step2VisualFunctional test={test} onMarkComplete={() => markStepComplete('step2')} pending={pending} />}
      {activeStep === 'step3' && <Step3Electrical test={test} onMarkComplete={() => markStepComplete('step3')} pending={pending} />}
    </div>
  )
}

/* ────────── Step 1: Asset Collection ────────── */
function Step1AssetCollection({
  test,
  onSave,
  onMarkComplete,
  pending,
}: {
  test: NsxTest
  onSave: (data: Parameters<typeof updateNsxDetailsAction>[1]) => void
  onMarkComplete: () => void
  pending: boolean
}) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onSave({
      brand: (fd.get('brand') as string) || null,
      breaker_type: (fd.get('breaker_type') as string) || null,
      name_location: (fd.get('name_location') as string) || null,
      cb_serial: (fd.get('cb_serial') as string) || null,
      current_in: (fd.get('current_in') as string) || null,
      trip_unit_model: (fd.get('trip_unit_model') as string) || null,
      cb_poles: (fd.get('cb_poles') as string) || null,
      fixed_withdrawable: ((fd.get('fixed_withdrawable') as string) || null) as 'fixed' | 'withdrawable' | 'plug_in' | null,
      long_time_ir: (fd.get('long_time_ir') as string) || null,
      long_time_delay_tr: (fd.get('long_time_delay_tr') as string) || null,
      short_time_pickup_isd: (fd.get('short_time_pickup_isd') as string) || null,
      short_time_delay_tsd: (fd.get('short_time_delay_tsd') as string) || null,
      instantaneous_pickup: (fd.get('instantaneous_pickup') as string) || null,
      earth_fault_pickup: (fd.get('earth_fault_pickup') as string) || null,
      earth_fault_delay: (fd.get('earth_fault_delay') as string) || null,
      step1_status: 'in_progress',
    })
  }

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-eq-ink mb-4">Asset Collection — NSX Breaker Identification</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FormInput label="Brand" name="brand" defaultValue={test.brand ?? ''} placeholder="e.g. Schneider" />
          <FormInput label="Breaker Type" name="breaker_type" defaultValue={test.breaker_type ?? ''} placeholder="e.g. NSX250" />
          <FormInput label="Name / Location" name="name_location" defaultValue={test.name_location ?? ''} />
          <FormInput label="Serial Number" name="cb_serial" defaultValue={test.cb_serial ?? ''} />
          <FormInput label="Current In (A)" name="current_in" defaultValue={test.current_in ?? ''} />
          <FormInput label="Trip Unit Model" name="trip_unit_model" defaultValue={test.trip_unit_model ?? ''} />
          <FormInput label="Poles" name="cb_poles" defaultValue={test.cb_poles ?? ''} placeholder="e.g. 3P" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Mounting</label>
            <select
              name="fixed_withdrawable"
              defaultValue={test.fixed_withdrawable ?? ''}
              className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
            >
              <option value="">—</option>
              <option value="fixed">Fixed</option>
              <option value="withdrawable">Withdrawable</option>
              <option value="plug_in">Plug-in</option>
            </select>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-eq-grey uppercase mt-2 mb-2">Protection Settings</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FormInput label="Long Time Ir" name="long_time_ir" defaultValue={test.long_time_ir ?? ''} />
            <FormInput label="Long Time tr" name="long_time_delay_tr" defaultValue={test.long_time_delay_tr ?? ''} />
            <FormInput label="Short Time Isd" name="short_time_pickup_isd" defaultValue={test.short_time_pickup_isd ?? ''} />
            <FormInput label="Short Time tsd" name="short_time_delay_tsd" defaultValue={test.short_time_delay_tsd ?? ''} />
            <FormInput label="Instantaneous" name="instantaneous_pickup" defaultValue={test.instantaneous_pickup ?? ''} />
            <FormInput label="Earth Fault Pickup" name="earth_fault_pickup" defaultValue={test.earth_fault_pickup ?? ''} />
            <FormInput label="Earth Fault Delay" name="earth_fault_delay" defaultValue={test.earth_fault_delay ?? ''} />
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save Collection'}
          </Button>
          <Button type="button" variant="secondary" onClick={onMarkComplete} disabled={pending}>
            Mark Step Complete
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ────────── Step 2: Visual & Functional (placeholder) ────────── */
function Step2VisualFunctional({ test, onMarkComplete, pending }: { test: NsxTest; onMarkComplete: () => void; pending: boolean }) {
  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-eq-ink mb-2">Visual & Functional Checks</h3>
      <p className="text-sm text-eq-grey mb-4">
        Framework placeholder — this step will mirror the ACB visual &amp; functional inspection
        (23 items across 5 sections). Populate the check list in a follow-up iteration.
      </p>
      <div className="p-4 bg-eq-ice/40 rounded-md border border-eq-sky/20 text-xs text-eq-grey">
        Current step status: <strong>{test.step2_status}</strong>
      </div>
      <div className="mt-4">
        <Button onClick={onMarkComplete} disabled={pending}>
          {pending ? 'Saving…' : 'Mark Step Complete'}
        </Button>
      </div>
    </Card>
  )
}

/* ────────── Step 3: Electrical Testing (placeholder) ────────── */
function Step3Electrical({ test, onMarkComplete, pending }: { test: NsxTest; onMarkComplete: () => void; pending: boolean }) {
  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-eq-ink mb-2">Electrical Testing</h3>
      <p className="text-sm text-eq-grey mb-4">
        Framework placeholder — this step will mirror the ACB electrical testing
        (contact resistance, IR closed/open, temperature, secondary injection). Populate
        the form fields in a follow-up iteration.
      </p>
      <div className="p-4 bg-eq-ice/40 rounded-md border border-eq-sky/20 text-xs text-eq-grey">
        Current step status: <strong>{test.step3_status}</strong>
      </div>
      <div className="mt-4">
        <Button onClick={onMarkComplete} disabled={pending}>
          {pending ? 'Saving…' : 'Mark Step Complete'}
        </Button>
      </div>
    </Card>
  )
}
