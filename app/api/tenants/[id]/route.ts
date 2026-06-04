import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPlatformKey } from '@/lib/api/platform-admin'
import { ok, err, notFound } from '@/lib/api/response'
import { UpdateTenantSchema } from '@/lib/validations/tenant'

// Out-of-band platform-provisioning endpoint — gated by the platform secret
// and executed with the service role (migration 0114). No tenant role reaches
// this; cross-tenant power is not derived from a tenant membership.

function gate(request: NextRequest) {
  const status = checkPlatformKey(request)
  if (status === 'unconfigured') {
    return err('Tenant provisioning is not configured on this deploy', 503)
  }
  if (status === 'denied') {
    return err('Forbidden', 403)
  }
  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = gate(request)
  if (blocked) return blocked
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Tenant')
      throw error
    }
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch tenant')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = gate(request)
  if (blocked) return blocked
  try {
    const { id } = await params
    const body = await request.json()
    const validated = UpdateTenantSchema.parse(body)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tenants')
      .update({ ...validated, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') return notFound('Tenant')
      throw error
    }
    return ok(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to update tenant')
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = gate(request)
  if (blocked) return blocked
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('tenants')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      if (error.code === 'PGRST116') return notFound('Tenant')
      throw error
    }
    return ok({ id })
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to delete tenant')
  }
}
