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
    const { name, slug, primary_colour, deep_colour, logo_url, skip_onboarding } = validated

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('tenants')
      .insert([{
        name,
        slug,
        is_active: true,
        // Canonical-provisioned tenants arrive already set up — skip the
        // first-run wizard by stamping the completion flag the gate checks.
        ...(skip_onboarding ? { setup_completed_at: new Date().toISOString() } : {}),
      }])
      .select()
      .single()

    if (error) throw error

    // Seed tenant_settings when the tenant is provisioned with its identity
    // already established (branding supplied and/or onboarding skipped). Mirror
    // `name` into report_company_name so the dashboard setup checklist reflects
    // the seeded company identity. No cross-tenant read — the provisioner passes
    // the canonical values in the request body. Service-role client bypasses RLS.
    const settingsSeed: Record<string, string> = {}
    if (primary_colour) settingsSeed.primary_colour = primary_colour
    if (deep_colour) settingsSeed.deep_colour = deep_colour
    if (logo_url) settingsSeed.logo_url = logo_url

    if (skip_onboarding || Object.keys(settingsSeed).length > 0) {
      const { error: settingsError } = await supabase
        .from('tenant_settings')
        .upsert(
          { tenant_id: data.id, report_company_name: name, ...settingsSeed },
          { onConflict: 'tenant_id' },
        )
      if (settingsError) throw settingsError
    }

    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create tenant')
  }
}
