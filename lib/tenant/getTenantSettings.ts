import { createClient } from '@/lib/supabase/server'
import type { TenantSettings } from '@/lib/types'

const DEFAULTS: TenantSettings = {
  id: '',
  tenant_id: '',
  primary_colour: '#3DA8D8',
  deep_colour: '#2986B4',
  ice_colour: '#EAF5FB',
  ink_colour: '#1A1A2E',
  logo_url: null,
  logo_url_on_dark: null,
  product_name: 'EQ Solves',
  support_email: null,
  // Report template defaults
  report_show_cover_page: true,
  report_show_site_overview: true,
  report_show_contents: true,
  report_show_executive_summary: true,
  report_show_sign_off: true,
  report_header_text: null,
  report_footer_text: null,
  report_company_name: null,
  report_company_address: null,
  report_company_abn: null,
  report_company_phone: null,
  report_sign_off_fields: ['Technician Signature', 'Supervisor Signature'],
  // Enhanced report settings
  report_logo_url: null,
  report_logo_url_on_dark: null,
  report_customer_logo: true,
  report_site_photos: false,
  report_complexity: 'standard',
  updated_at: '',
}

/**
 * Fetches the tenant settings for the current authenticated user.
 * Falls back to EQ defaults if no tenant membership or settings exist.
 */
export async function getTenantSettings(): Promise<{
  settings: TenantSettings
  tenantId: string | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { settings: DEFAULTS, tenantId: null }

  // Get user's tenant membership
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) return { settings: DEFAULTS, tenantId: null }

  // Get tenant settings
  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('*')
    .eq('tenant_id', membership.tenant_id)
    .maybeSingle()

  return {
    settings: settings ? (settings as TenantSettings) : { ...DEFAULTS, tenant_id: membership.tenant_id },
    tenantId: membership.tenant_id,
  }
}
