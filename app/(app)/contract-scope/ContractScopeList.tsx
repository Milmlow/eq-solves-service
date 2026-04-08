'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { Card } from '@/components/ui/Card'
import { createScopeItemAction, updateScopeItemAction, deleteScopeItemAction } from './actions'
import type { ContractScope, Customer, Site } from '@/lib/types'
import { Plus, Pencil, Trash2, X, CheckCircle2, XCircle, Filter } from 'lucide-react'

// Australian FY options
const FY_OPTIONS = [
  '2024-2025',
  '2025-2026',
  '2026-2027',
  '2027-2028',
]

function fyLabel(fy: string) {
  return `FY ${fy}`
}

interface ContractScopeListProps {
  items: (ContractScope & { customers: { name: string } | null; sites: { name: string } | null })[]
  customers: Pick<Customer, 'id' | 'name'>[]
  sites: Pick<Site, 'id' | 'name' | 'customer_id'>[]
  canWrite: boolean
  isAdmin: boolean
}

export function ContractScopeList({ items, customers, sites, canWrite: canWriteRole, isAdmin: isAdminRole }: ContractScopeListProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ContractScope | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Filters
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterFY, setFilterFY] = useState(currentFY())
  const [filterIncluded, setFilterIncluded] = useState<'all' | 'yes' | 'no'>('all')

  // Form state for dynamic site filter
  const [formCustomerId, setFormCustomerId] = useState('')

  function currentFY() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1 // 1-12
    // AU FY: Jul-Jun. If before July, current FY started previous year
    if (month < 7) return `${year - 1}-${year}`
    return `${year}-${year + 1}`
  }

  const filteredSites = useMemo(() => {
    if (!formCustomerId) return sites
    return sites.filter(s => s.customer_id === formCustomerId)
  }, [sites, formCustomerId])

  const filtered = useMemo(() => {
    let result = items
    if (filterCustomer) result = result.filter(i => i.customer_id === filterCustomer)
    if (filterFY) result = result.filter(i => i.financial_year === filterFY)
    if (filterIncluded === 'yes') result = result.filter(i => i.is_included)
    if (filterIncluded === 'no') result = result.filter(i => !i.is_included)
    return result
  }, [items, filterCustomer, filterFY, filterIncluded])

  // Group by customer
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const item of filtered) {
      const key = item.customers?.name ?? 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = editing
      ? await updateScopeItemAction(editing.id, formData)
      : await createScopeItemAction(formData)

    setLoading(false)
    if (result.success) {
      setShowForm(false)
      setEditing(null)
      setFormCustomerId('')
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleDelete(item: ContractScope) {
    if (!confirm(`Delete this scope item?`)) return
    setLoading(true)
    const result = await deleteScopeItemAction(item.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Something went wrong.')
  }

  function startEdit(item: ContractScope) {
    setEditing(item)
    setFormCustomerId(item.customer_id)
    setShowForm(true)
    setError(null)
  }

  function cancelForm() {
    setShowForm(false)
    setEditing(null)
    setFormCustomerId('')
    setError(null)
  }

  const includedCount = filtered.filter(i => i.is_included).length
  const excludedCount = filtered.filter(i => !i.is_included).length

  return (
    <div className="space-y-4">
      {/* Filters + Add button */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-eq-grey" />
          <select
            value={filterFY}
            onChange={(e) => setFilterFY(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="">All Years</option>
            {FY_OPTIONS.map(fy => (
              <option key={fy} value={fy}>{fyLabel(fy)}</option>
            ))}
          </select>
          <select
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="">All Customers</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={filterIncluded}
            onChange={(e) => setFilterIncluded(e.target.value as 'all' | 'yes' | 'no')}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="all">All Items</option>
            <option value="yes">Included Only</option>
            <option value="no">Excluded Only</option>
          </select>
        </div>
        <div className="ml-auto">
          {canWriteRole && !showForm && (
            <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); setError(null) }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Scope Item
            </Button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-green-700">
          <CheckCircle2 className="w-4 h-4" /> {includedCount} included
        </span>
        <span className="flex items-center gap-1.5 text-red-600">
          <XCircle className="w-4 h-4" /> {excludedCount} excluded
        </span>
        <span className="text-eq-grey">({filtered.length} total items)</span>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-eq-deep">{editing ? 'Edit Scope Item' : 'New Scope Item'}</h3>
              <button type="button" onClick={cancelForm} className="text-eq-grey hover:text-eq-ink"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer *</label>
                <select
                  name="customer_id"
                  required
                  defaultValue={editing?.customer_id ?? ''}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  <option value="">Select customer...</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site (optional)</label>
                <select
                  name="site_id"
                  defaultValue={editing?.site_id ?? ''}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  <option value="">All sites</option>
                  {filteredSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Financial Year *</label>
                <select
                  name="financial_year"
                  required
                  defaultValue={editing?.financial_year ?? (filterFY || currentFY())}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  {FY_OPTIONS.map(fy => (
                    <option key={fy} value={fy}>{fyLabel(fy)}</option>
                  ))}
                </select>
              </div>
            </div>
            <FormInput label="Scope Item *" name="scope_item" required defaultValue={editing?.scope_item ?? ''} placeholder="e.g. Annual PM on all UPS systems" />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Included in Contract?</label>
                <select
                  name="is_included"
                  defaultValue={editing ? (editing.is_included ? 'true' : 'false') : 'true'}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  <option value="true">Yes — Included</option>
                  <option value="false">No — Excluded / Out of Scope</option>
                </select>
              </div>
              <FormInput label="Notes" name="notes" defaultValue={editing?.notes ?? ''} placeholder="Budget notes, variation ref, etc." />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={loading}>{loading ? 'Saving...' : editing ? 'Update' : 'Add Item'}</Button>
              <Button type="button" variant="secondary" size="sm" onClick={cancelForm}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Grouped list */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-1">No scope items found.</p>
          <p className="text-eq-grey text-xs">Use &quot;Add Scope Item&quot; to define what&apos;s in and out of your contracts.</p>
        </div>
      ) : (
        grouped.map(([customerName, customerItems]) => (
          <div key={customerName} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-3 bg-eq-ice/40 border-b border-gray-100">
              <h3 className="font-semibold text-eq-deep text-sm">{customerName}</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {customerItems.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 shrink-0">
                    {item.is_included ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-eq-ink text-sm">{item.scope_item}</span>
                      {item.sites && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-eq-grey">{item.sites.name}</span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-eq-ice text-eq-deep">{fyLabel(item.financial_year)}</span>
                    </div>
                    {item.notes && <p className="text-xs text-eq-grey mt-0.5">{item.notes}</p>}
                  </div>
                  {canWriteRole && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => startEdit(item)} className="p-1.5 text-eq-grey hover:text-eq-sky transition-colors" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {isAdminRole && (
                        <button onClick={() => handleDelete(item)} className="p-1.5 text-eq-grey hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
