'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { Card } from '@/components/ui/Card'
import { updateAcbDetailsAction, saveAcbVisualCheckAction, saveAcbElectricalReadingAction, raiseTestDefectAction } from '@/app/(app)/acb-testing/actions'
import { CheckCircle2, AlertCircle, Zap } from 'lucide-react'
import type { AcbTest, AcbTestReading } from '@/lib/types'

interface AcbWorkflowProps {
  test: AcbTest
  readings: AcbTestReading[]
  onUpdate: () => void
}

type TabType = 'step1' | 'step2' | 'step3'

export function AcbWorkflow({ test, readings, onUpdate }: AcbWorkflowProps) {
  const [activeTab, setActiveTab] = useState<TabType>('step1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDefectPrompt, setShowDefectPrompt] = useState(false)
  const [defectTitle, setDefectTitle] = useState('')

  // Tab indicator status
  const getTabStatus = (tab: TabType) => {
    const status = test[`${tab}_status` as keyof AcbTest] as string
    if (status === 'complete') return 'complete'
    if (status === 'in_progress') return 'in-progress'
    return 'not-started'
  }

  const visualCheckReadings = readings.filter(r => r.label?.includes('Visual Check:'))
  const electricalReadings = readings.filter(r => r.label?.includes('Electrical:'))

  // Check for failures
  const step2HasFails = visualCheckReadings.some(r => r.is_pass === false)
  const step3HasFails = electricalReadings.some(r => r.is_pass === false)

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {[
          { id: 'step1', label: 'Step 1: Details', status: getTabStatus('step1') },
          { id: 'step2', label: 'Step 2: Visual', status: getTabStatus('step2') },
          { id: 'step3', label: 'Step 3: Electrical', status: getTabStatus('step3') },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-eq-sky text-eq-sky'
                : 'border-transparent text-eq-grey hover:text-eq-ink'
            }`}
          >
            <div className="flex items-center gap-2">
              {tab.label}
              {tab.status === 'complete' && (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              )}
              {tab.status === 'in-progress' && (
                <div className="w-2 h-2 bg-amber-500 rounded-full" />
              )}
            </div>
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Circuit Breaker Details */}
      {activeTab === 'step1' && (
        <Step1DetailsTab test={test} loading={loading} setLoading={setLoading} setError={setError} onUpdate={onUpdate} />
      )}

      {/* Step 2: Visual & Functional Test */}
      {activeTab === 'step2' && (
        <Step2VisualTab
          test={test}
          readings={visualCheckReadings}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          onUpdate={onUpdate}
          onFailDetected={() => step2HasFails && setShowDefectPrompt(true)}
        />
      )}

      {/* Step 3: Electrical Testing */}
      {activeTab === 'step3' && (
        <Step3ElectricalTab
          test={test}
          readings={electricalReadings}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          onUpdate={onUpdate}
          onFailDetected={() => step3HasFails && setShowDefectPrompt(true)}
        />
      )}

      {/* Defect Prompt */}
      {showDefectPrompt && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Fails detected</p>
              <p className="text-xs text-red-700 mt-1">Would you like to raise a rectification item (defect)?</p>
            </div>
          </div>
          <div className="space-y-2">
            <FormInput
              label="Defect Title"
              value={defectTitle}
              onChange={(e) => setDefectTitle(e.target.value)}
              placeholder="e.g. Failed visual inspection - arc chutes damaged"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!defectTitle.trim()) {
                    setError('Please enter a defect title')
                    return
                  }
                  setLoading(true)
                  const result = await raiseTestDefectAction({
                    asset_id: test.asset_id,
                    site_id: test.site_id,
                    title: defectTitle,
                    severity: 'high',
                  })
                  setLoading(false)
                  if (result.success) {
                    setShowDefectPrompt(false)
                    setDefectTitle('')
                    onUpdate()
                  } else {
                    setError(result.error ?? 'Failed to create defect')
                  }
                }}
                disabled={loading}
              >
                Create Defect
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setShowDefectPrompt(false)
                  setDefectTitle('')
                }}
              >
                Skip
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Step 1: Circuit Breaker Details
function Step1DetailsTab({
  test, loading, setLoading, setError, onUpdate,
}: {
  test: AcbTest
  loading: boolean
  setLoading: (b: boolean) => void
  setError: (e: string | null) => void
  onUpdate: () => void
}) {
  const [formData, setFormData] = useState({
    cb_make: test.cb_make || '',
    cb_model: test.cb_model || '',
    cb_serial: test.cb_serial || '',
    cb_rating: test.cb_rating || '',
    cb_poles: test.cb_poles || '',
    trip_unit: test.trip_unit || '',
    trip_settings_ir: test.trip_settings_ir || '',
    trip_settings_isd: test.trip_settings_isd || '',
    trip_settings_ii: test.trip_settings_ii || '',
    trip_settings_ig: test.trip_settings_ig || '',
  })

  async function handleSave() {
    setError(null)
    setLoading(true)
    const result = await updateAcbDetailsAction(test.id, {
      ...formData,
      step1_status: 'complete',
    })
    setLoading(false)
    if (result.success) {
      onUpdate()
    } else {
      setError(result.error ?? 'Failed to save details')
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="font-medium text-eq-ink mb-4">Circuit Breaker Specifications</h3>
        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="Make"
            value={formData.cb_make}
            onChange={(e) => setFormData({ ...formData, cb_make: e.target.value })}
            placeholder="e.g. ABB, Schneider"
          />
          <FormInput
            label="Model"
            value={formData.cb_model}
            onChange={(e) => setFormData({ ...formData, cb_model: e.target.value })}
            placeholder="e.g. Emax E2"
          />
          <FormInput
            label="Serial Number"
            value={formData.cb_serial}
            onChange={(e) => setFormData({ ...formData, cb_serial: e.target.value })}
            placeholder="Serial number"
          />
          <FormInput
            label="Rating"
            value={formData.cb_rating}
            onChange={(e) => setFormData({ ...formData, cb_rating: e.target.value })}
            placeholder="e.g. 630A"
          />
          <FormInput
            label="Poles"
            value={formData.cb_poles}
            onChange={(e) => setFormData({ ...formData, cb_poles: e.target.value })}
            placeholder="e.g. 3P"
          />
          <FormInput
            label="Trip Unit"
            value={formData.trip_unit}
            onChange={(e) => setFormData({ ...formData, trip_unit: e.target.value })}
            placeholder="e.g. Electronic"
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-4">Trip Settings</h3>
        <div className="grid grid-cols-4 gap-4">
          <FormInput
            label="Ir (A)"
            value={formData.trip_settings_ir}
            onChange={(e) => setFormData({ ...formData, trip_settings_ir: e.target.value })}
            placeholder="Rated current"
          />
          <FormInput
            label="Isd (A)"
            value={formData.trip_settings_isd}
            onChange={(e) => setFormData({ ...formData, trip_settings_isd: e.target.value })}
            placeholder="Short delay"
          />
          <FormInput
            label="Ii (A)"
            value={formData.trip_settings_ii}
            onChange={(e) => setFormData({ ...formData, trip_settings_ii: e.target.value })}
            placeholder="Instantaneous"
          />
          <FormInput
            label="Ig (A)"
            value={formData.trip_settings_ig}
            onChange={(e) => setFormData({ ...formData, trip_settings_ig: e.target.value })}
            placeholder="Ground"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? 'Saving...' : 'Complete Step 1'}
        </Button>
      </div>
    </Card>
  )
}

// Step 2: Visual & Functional Test
function Step2VisualTab({
  test, readings, loading, setLoading, setError, onUpdate, onFailDetected,
}: {
  test: AcbTest
  readings: AcbTestReading[]
  loading: boolean
  setLoading: (b: boolean) => void
  setError: (e: string | null) => void
  onUpdate: () => void
  onFailDetected: () => void
}) {
  const [items, setItems] = useState<Array<{
    label: string
    result: 'pass' | 'fail' | 'na'
    comment?: string
  }>>(
    readings.length > 0
      ? readings.map(r => ({
        label: r.label.replace('Visual Check: ', ''),
        result: r.is_pass === true ? 'pass' : r.is_pass === false ? 'fail' : 'na',
        comment: r.value,
      }))
      : [
        { label: 'General condition / cleanliness', result: 'pass' },
        { label: 'Arc chute condition', result: 'pass' },
        { label: 'Main contact condition', result: 'pass' },
        { label: 'Auxiliary contact condition', result: 'pass' },
        { label: 'Mechanical operation (racking in/out)', result: 'pass' },
        { label: 'Spring charging mechanism', result: 'pass' },
        { label: 'Trip unit visual check', result: 'pass' },
        { label: 'Wiring and connections', result: 'pass' },
        { label: 'Labelling and identification', result: 'pass' },
      ]
  )

  async function handleSave() {
    setError(null)
    setLoading(true)
    const result = await saveAcbVisualCheckAction(test.id, items)
    setLoading(false)
    if (result.success) {
      if (items.some(i => i.result === 'fail')) {
        onFailDetected()
      }
      onUpdate()
    } else {
      setError(result.error ?? 'Failed to save visual check')
    }
  }

  const hasFails = items.some(i => i.result === 'fail')

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium text-eq-ink">Standard Inspection Items</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {items.map((item, idx) => (
          <div key={idx} className="p-3 border border-gray-200 rounded-md space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-eq-ink">{item.label}</label>
              <div className="flex gap-2">
                {(['pass', 'fail', 'na'] as const).map(result => (
                  <button
                    key={result}
                    onClick={() => {
                      const newItems = [...items]
                      newItems[idx].result = result
                      setItems(newItems)
                    }}
                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                      item.result === result
                        ? result === 'pass'
                          ? 'bg-green-600 text-white'
                          : result === 'fail'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {result === 'pass' ? 'Pass' : result === 'fail' ? 'Fail' : 'N/A'}
                  </button>
                ))}
              </div>
            </div>
            {item.result === 'fail' && (
              <input
                type="text"
                value={item.comment || ''}
                onChange={(e) => {
                  const newItems = [...items]
                  newItems[idx].comment = e.target.value
                  setItems(newItems)
                }}
                placeholder="Add comment about failure..."
                className="w-full px-2 py-1 text-xs border border-red-300 rounded bg-red-50 placeholder-red-400"
              />
            )}
          </div>
        ))}
      </div>

      {hasFails && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
          <p className="text-xs text-red-700">This inspection has failures. A defect will be created when you save.</p>
        </div>
      )}

      <div className="flex gap-2 pt-4">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? 'Saving...' : 'Complete Step 2'}
        </Button>
      </div>
    </Card>
  )
}

// Step 3: Electrical Testing
function Step3ElectricalTab({
  test, readings, loading, setLoading, setError, onUpdate, onFailDetected,
}: {
  test: AcbTest
  readings: AcbTestReading[]
  loading: boolean
  setLoading: (b: boolean) => void
  setError: (e: string | null) => void
  onUpdate: () => void
  onFailDetected: () => void
}) {
  const [readings_data, setReadingsData] = useState<Array<{
    label: string
    value: string
    unit: string
    is_pass?: boolean
  }>>(
    readings.length > 0
      ? readings.map(r => ({
        label: r.label.replace('Electrical: ', ''),
        value: r.value,
        unit: r.unit || '',
        is_pass: r.is_pass ?? undefined,
      }))
      : [
        { label: 'Insulation Resistance A-E', value: '', unit: 'MΩ' },
        { label: 'Insulation Resistance B-E', value: '', unit: 'MΩ' },
        { label: 'Insulation Resistance C-E', value: '', unit: 'MΩ' },
        { label: 'Contact Resistance Phase A', value: '', unit: 'μΩ' },
        { label: 'Contact Resistance Phase B', value: '', unit: 'μΩ' },
        { label: 'Contact Resistance Phase C', value: '', unit: 'μΩ' },
        { label: 'Overcurrent Trip Time', value: '', unit: 'ms' },
      ]
  )

  async function handleSave() {
    setError(null)
    setLoading(true)
    const result = await saveAcbElectricalReadingAction(test.id, readings_data)
    setLoading(false)
    if (result.success) {
      if (readings_data.some(r => r.is_pass === false)) {
        onFailDetected()
      }
      onUpdate()
    } else {
      setError(result.error ?? 'Failed to save electrical readings')
    }
  }

  const hasFails = readings_data.some(r => r.is_pass === false)

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium text-eq-ink flex items-center gap-2">
        <Zap className="w-4 h-4" />
        Electrical Test Readings
      </h3>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {readings_data.map((rdg, idx) => (
          <div key={idx} className="p-3 border border-gray-200 rounded-md grid grid-cols-4 gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Reading</label>
              <input
                type="text"
                value={rdg.label}
                onChange={(e) => {
                  const newReadings = [...readings_data]
                  newReadings[idx].label = e.target.value
                  setReadingsData(newReadings)
                }}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Value</label>
              <input
                type="text"
                value={rdg.value}
                onChange={(e) => {
                  const newReadings = [...readings_data]
                  newReadings[idx].value = e.target.value
                  setReadingsData(newReadings)
                }}
                placeholder="e.g. 125"
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Unit</label>
              <input
                type="text"
                value={rdg.unit}
                onChange={(e) => {
                  const newReadings = [...readings_data]
                  newReadings[idx].unit = e.target.value
                  setReadingsData(newReadings)
                }}
                placeholder="e.g. MΩ"
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Result</label>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    const newReadings = [...readings_data]
                    newReadings[idx].is_pass = true
                    setReadingsData(newReadings)
                  }}
                  className={`flex-1 px-2 py-1 text-xs rounded font-medium transition-colors ${
                    rdg.is_pass === true
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  P
                </button>
                <button
                  onClick={() => {
                    const newReadings = [...readings_data]
                    newReadings[idx].is_pass = false
                    setReadingsData(newReadings)
                  }}
                  className={`flex-1 px-2 py-1 text-xs rounded font-medium transition-colors ${
                    rdg.is_pass === false
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  F
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasFails && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
          <p className="text-xs text-red-700">This test has failures. A defect will be created when you save.</p>
        </div>
      )}

      <div className="flex gap-2 pt-4">
        <Button onClick={handleSave} disabled={loading}>
          {loading ? 'Saving...' : 'Complete Step 3'}
        </Button>
      </div>
    </Card>
  )
}
