'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'
import { isAdmin, canWrite } from '@/lib/utils/roles'

export async function createScopeItemAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const customer_id = formData.get('customer_id') as string
    const site_id = (formData.get('site_id') as string) || null
    const financial_year = (formData.get('financial_year') as string) || '2025-2026'
    const scope_item = (formData.get('scope_item') as string)?.trim()
    const is_included = formData.get('is_included') === 'true'
    const notes = (formData.get('notes') as string)?.trim() || null

    if (!customer_id) return { success: false, error: 'Customer is required.' }
    if (!scope_item) return { success: false, error: 'Scope item is required.' }

    const { error } = await supabase
      .from('contract_scopes')
      .insert({ tenant_id: tenantId, customer_id, site_id, financial_year, scope_item, is_included, notes })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'contract_scope', summary: `Added scope item "${scope_item}" for FY ${financial_year}` })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateScopeItemAction(id: string, formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const customer_id = formData.get('customer_id') as string
    const site_id = (formData.get('site_id') as string) || null
    const financial_year = (formData.get('financial_year') as string) || '2025-2026'
    const scope_item = (formData.get('scope_item') as string)?.trim()
    const is_included = formData.get('is_included') === 'true'
    const notes = (formData.get('notes') as string)?.trim() || null

    if (!scope_item) return { success: false, error: 'Scope item is required.' }

    const { error } = await supabase
      .from('contract_scopes')
      .update({ customer_id, site_id, financial_year, scope_item, is_included, notes })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'contract_scope', entityId: id, summary: `Updated scope item "${scope_item}"` })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function importScopeItemsAction(items: {
  customer_name: string
  site_name: string | null
  financial_year: string
  scope_item: string
  is_included: boolean
  notes: string | null
}[]) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    // Build lookup maps for customers and sites
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name')
      .eq('is_active', true)
    const custMap: Record<string, string> = {}
    for (const c of customers ?? []) custMap[c.name.toLowerCase()] = c.id

    const { data: sites } = await supabase
      .from('sites')
      .select('id, name')
      .eq('is_active', true)
    const siteMap: Record<string, string> = {}
    for (const s of sites ?? []) siteMap[s.name.toLowerCase()] = s.id

    let imported = 0
    let skipped = 0
    for (const item of items) {
      const customerId = custMap[item.customer_name.toLowerCase()]
      if (!customerId) { skipped++; continue }
      const siteId = item.site_name ? (siteMap[item.site_name.toLowerCase()] ?? null) : null

      const { error } = await supabase
        .from('contract_scopes')
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          site_id: siteId,
          financial_year: item.financial_year || '2025-2026',
          scope_item: item.scope_item,
          is_included: item.is_included,
          notes: item.notes,
        })

      if (error) { skipped++; continue }
      imported++
    }

    await logAuditEvent({ action: 'create', entityType: 'contract_scope', summary: `Imported ${imported} scope items` })
    revalidatePath('/contract-scope')
    return { success: true, imported, skipped }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function deleteScopeItemAction(id: string) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    const { error } = await supabase
      .from('contract_scopes')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'delete', entityType: 'contract_scope', entityId: id, summary: 'Deleted scope item' })
    revalidatePath('/contract-scope')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
