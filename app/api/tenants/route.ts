import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformAdminRequest } from '@/lib/api/platform'
import { ok, created, err, forbidden } from '@/lib/api/response'
import { CreateTenantSchema } from '@/lib/validations/tenant'

// Tenant management is a PLATFORM operation (Sprint C6) — it spans every
// tenant, so it lives OUT-OF-BAND, gated on EQ_PLATFORM_ADMIN_KEY rather than
// a tenant-held role. A super_admin sitting inside one tenant can no longer
// reach this surface. Requests use the service-role client (RLS-bypass);
// RLS no longer grants tenant CRUD to any authenticated tenant session.

export async function GET(request: NextRequest) {
  try {
    if (!isPlatformAdminRequest(request)) return forbidden()

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
  try {
    if (!isPlatformAdminRequest(request)) return forbidden()

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
