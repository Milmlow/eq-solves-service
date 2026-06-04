import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPlatformKey } from '@/lib/api/platform-admin'
import { ok, created, err } from '@/lib/api/response'
import { CreateTenantSchema } from '@/lib/validations/tenant'

// Tenant provisioning is an EQ-internal, out-of-band operation (migration
// 0114): no tenant user holds a role that can reach it. Gated by the platform
// secret (x-eq-platform-key) and executed with the service-role client, which
// bypasses RLS. There is no tenant-scoped session involved.

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

export async function GET(request: NextRequest) {
  const blocked = gate(request)
  if (blocked) return blocked
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) throw error
    return ok(data)
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch tenants')
  }
}

export async function POST(request: NextRequest) {
  const blocked = gate(request)
  if (blocked) return blocked
  try {
    const body = await request.json()
    const validated = CreateTenantSchema.parse(body)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tenants')
      .insert([{ ...validated, is_active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create tenant')
  }
}
