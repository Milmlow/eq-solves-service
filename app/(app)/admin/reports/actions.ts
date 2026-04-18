'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'

interface ReportSettingsUpdate {
  report_show_cover_page: boolean
  report_show_site_overview: boolean
  report_show_contents: boolean
  report_show_executive_summary: boolean
  report_show_sign_off: boolean
  report_header_text: string | null
  report_footer_text: string | null
  report_company_name: string | null
  report_company_address: string | null
  report_company_abn: string | null
  report_company_phone: string | null
  report_sign_off_fields: string[]
  report_logo_url: string | null
  report_customer_logo: boolean
  report_site_photos: boolean
  report_complexity: 'summary' | 'standard' | 'detailed'
}

export async function updateReportSettingsAction(data: ReportSettingsUpdate) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Insufficient permissions.' }

    // Validate sign-off fields
    if (!Array.isArray(data.report_sign_off_fields) || data.report_sign_off_fields.length === 0) {
      return { success: false, error: 'At least one sign-off field is required.' }
    }

    // Trim text fields
    const update = {
      report_show_cover_page: data.report_show_cover_page,
      report_show_site_overview: data.report_show_site_overview,
      report_show_contents: data.report_show_contents,
      report_show_executive_summary: data.report_show_executive_summary,
      report_show_sign_off: data.report_show_sign_off,
      report_header_text: data.report_header_text?.trim() || null,
      report_footer_text: data.report_footer_text?.trim() || null,
      report_company_name: data.report_company_name?.trim() || null,
      report_company_address: data.report_company_address?.trim() || null,
      report_company_abn: data.report_company_abn?.trim() || null,
      report_company_phone: data.report_company_phone?.trim() || null,
      report_sign_off_fields: data.report_sign_off_fields.filter(f => f.trim().length > 0),
      report_logo_url: data.report_logo_url?.trim() || null,
      report_customer_logo: data.report_customer_logo ?? true,
      report_site_photos: data.report_site_photos ?? false,
      report_complexity: data.report_complexity ?? 'standard',
    }

    const { error } = await supabase
      .from('tenant_settings')
      .update(update)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'tenant_settings', summary: 'Updated report settings' })
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
