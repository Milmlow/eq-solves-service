'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { canWrite, isAdmin } from '@/lib/utils/roles'
import { logAuditEvent } from '@/lib/actions/audit'
import { CreatePmCalendarSchema, UpdatePmCalendarSchema } from '@/lib/validations/pm-calendar'

// ===== Helper: compute AU FY quarter & year from a date =====
function computeAuFyQuarter(dateStr: string): { quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4'; financial_year: string } {
  const d = new Date(dateStr)
  const month = d.getMonth() // 0-indexed
  const year = d.getFullYear()

  // AU FY: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
  let quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4'
  let fyStart: number

  if (month >= 6 && month <= 8) { // Jul-Sep
    quarter = 'Q1'
    fyStart = year
  } else if (month >= 9 && month <= 11) { // Oct-Dec
    quarter = 'Q2'
    fyStart = year
  } else if (month >= 0 && month <= 2) { // Jan-Mar
    quarter = 'Q3'
    fyStart = year - 1
  } else { // Apr-Jun
    quarter = 'Q4'
    fyStart = year - 1
  }

  return { quarter, financial_year: `${fyStart}-${fyStart + 1}` }
}

// ===== CREATE =====
export async function createPmCalendarAction(formData: FormData) {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id') as string,
      title: formData.get('title') as string,
      location: formData.get('location') || null,
      description: formData.get('description') || null,
      category: formData.get('category') as string,
      start_time: formData.get('start_time') as string,
      end_time: formData.get('end_time') || null,
      hours: formData.get('hours') || 0,
      contractor_materials_cost: formData.get('contractor_materials_cost') || 0,
      assigned_to: formData.get('assigned_to') || null,
      status: formData.get('status') || 'scheduled',
      reminder_days_before: [],
      notification_recipients: [],
      email_template: null,
    }

    const parsed = CreatePmCalendarSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Auto-compute quarter and FY
    const { quarter, financial_year } = computeAuFyQuarter(parsed.data.start_time)

    const { error } = await supabase
      .from('pm_calendar')
      .insert({
        ...parsed.data,
        tenant_id: tenantId,
        quarter,
        financial_year,
      })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'create', entityType: 'pm_calendar', summary: `Created PM calendar entry "${parsed.data.title}"` })
    revalidatePath('/pm-calendar')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ===== UPDATE =====
export async function updatePmCalendarAction(id: string, formData: FormData) {
  try {
    const { supabase, role } = await requireUser()
    if (!canWrite(role)) return { success: false, error: 'Insufficient permissions.' }

    const raw = {
      site_id: formData.get('site_id') as string,
      title: formData.get('title') as string,
      location: formData.get('location') || null,
      description: formData.get('description') || null,
      category: formData.get('category') as string,
      start_time: formData.get('start_time') as string,
      end_time: formData.get('end_time') || null,
      hours: formData.get('hours') || 0,
      contractor_materials_cost: formData.get('contractor_materials_cost') || 0,
      assigned_to: formData.get('assigned_to') || null,
      status: formData.get('status') || 'scheduled',
    }

    const parsed = UpdatePmCalendarSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

    // Recompute quarter/FY if start_time changed
    let extra: Record<string, string> = {}
    if (parsed.data.start_time) {
      const { quarter, financial_year } = computeAuFyQuarter(parsed.data.start_time)
      extra = { quarter, financial_year }
    }

    const { error } = await supabase
      .from('pm_calendar')
      .update({ ...parsed.data, ...extra })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'pm_calendar', entityId: id, summary: 'Updated PM calendar entry' })
    revalidatePath('/pm-calendar')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ===== TOGGLE ACTIVE =====
export async function togglePmCalendarActiveAction(id: string, active: boolean) {
  try {
    const { supabase, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin only.' }

    const { error } = await supabase
      .from('pm_calendar')
      .update({ is_active: active })
      .eq('id', id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: active ? 'reactivate' : 'deactivate',
      entityType: 'pm_calendar',
      entityId: id,
      summary: `${active ? 'Reactivated' : 'Deactivated'} PM calendar entry`,
    })
    revalidatePath('/pm-calendar')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

// ===== SEED DATA =====
export async function seedPmCalendarAction() {
  try {
    const { supabase, tenantId, role } = await requireUser()
    if (!isAdmin(role)) return { success: false, error: 'Admin only.' }

    // Get sites by code
    const { data: sites } = await supabase
      .from('sites')
      .select('id, name, code, address')
      .eq('is_active', true)

    if (!sites || sites.length === 0) return { success: false, error: 'No sites found. Create sites first.' }

    // Map site codes to IDs
    const siteMap: Record<string, { id: string; address: string | null }> = {}
    for (const s of sites) {
      const code = (s.code ?? s.name).toUpperCase()
      siteMap[code] = { id: s.id, address: s.address }
      // Also try just the name
      siteMap[s.name.toUpperCase()] = { id: s.id, address: s.address }
    }

    function findSite(code: string) {
      return siteMap[code.toUpperCase()] ?? null
    }

    // Equinix site addresses for reference
    const siteAddresses: Record<string, string> = {
      CA1: '51 Dacre Street, Mitchell ACT 2911',
      SY1: '639 Gardeners Rd, Mascot NSW 2020',
      SY2: '639 Gardeners Rd, Mascot NSW 2020',
      SY3: '47 Bourke Rd, Alexandria NSW 2015',
      SY6: '8-14 Egerton St, Silverwater NSW 2128',
      SY7: '8-14 Egerton St, Silverwater NSW 2128',
      SY9: '17-23 Egerton St, Silverwater NSW 2128',
    }

    type SeedEntry = {
      site_code: string
      title: string
      location: string
      category: string
      description: string
      start_time: string
      end_time: string
      hours: number
      cost: number
    }

    // ~100 seed entries across 7 sites covering full 2026 calendar year
    const seedEntries: SeedEntry[] = [
      // === CA1 — 51 Dacre Street Mitchell ===
      { site_code: 'CA1', title: 'Thermal Scanning — HV Switchgear', location: 'HV Switch Room', category: 'Thermal scanning', description: 'Bi-annual thermal scan of all HV switchgear panels. Contractor: ThermoTech. Contact: Dave 0412 555 001', start_time: '2025-08-18T08:00:00+10:00', end_time: '2025-08-18T16:00:00+10:00', hours: 8, cost: 2400 },
      { site_code: 'CA1', title: 'Thermal Scanning — LV Distribution', location: 'LV Switch Room A & B', category: 'Thermal scanning', description: 'Bi-annual thermal scan of LV distribution boards and MCCs', start_time: '2026-02-16T08:00:00+11:00', end_time: '2026-02-16T16:00:00+11:00', hours: 8, cost: 2400 },
      { site_code: 'CA1', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting duration test — 90 minute discharge. Log all fittings.', start_time: '2025-09-22T06:00:00+10:00', end_time: '2025-09-22T14:00:00+10:00', hours: 8, cost: 1200 },
      { site_code: 'CA1', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting duration test — 90 minute discharge', start_time: '2026-03-23T06:00:00+11:00', end_time: '2026-03-23T14:00:00+11:00', hours: 8, cost: 1200 },
      { site_code: 'CA1', title: 'Lightning Protection Testing', location: 'Roof / External', category: 'Lightning protection testing', description: 'Annual lightning protection system test — earth resistance, bonding, visual inspection of air terminals', start_time: '2025-10-13T07:00:00+11:00', end_time: '2025-10-13T15:00:00+11:00', hours: 8, cost: 3200 },
      { site_code: 'CA1', title: 'RCD Testing — All Circuits', location: 'All Distribution Boards', category: 'RCD testing', description: 'Annual RCD testing per AS/NZS 3760. Trip time and current measurements.', start_time: '2025-11-10T07:00:00+11:00', end_time: '2025-11-10T15:00:00+11:00', hours: 8, cost: 1800 },
      { site_code: 'CA1', title: 'Test and Tag — Office & Common Areas', location: 'Office, Kitchen, Meeting Rooms', category: 'Test and tagging', description: 'Annual test and tag of all portable electrical equipment per AS/NZS 3760', start_time: '2025-12-08T08:00:00+11:00', end_time: '2025-12-08T16:00:00+11:00', hours: 8, cost: 950 },
      { site_code: 'CA1', title: 'Quarterly Maintenance — Q1', location: 'All Electrical Infrastructure', category: 'Quarterly maintenance', description: 'Q1 preventative maintenance: visual inspections, torque checks, thermal checks, general condition assessment', start_time: '2025-07-14T07:00:00+10:00', end_time: '2025-07-18T15:00:00+10:00', hours: 40, cost: 8500 },
      { site_code: 'CA1', title: 'Quarterly Maintenance — Q2', location: 'All Electrical Infrastructure', category: 'Quarterly maintenance', description: 'Q2 preventative maintenance', start_time: '2025-10-20T07:00:00+11:00', end_time: '2025-10-24T15:00:00+11:00', hours: 40, cost: 8500 },
      { site_code: 'CA1', title: 'Quarterly Maintenance — Q3', location: 'All Electrical Infrastructure', category: 'Quarterly maintenance', description: 'Q3 preventative maintenance', start_time: '2026-01-19T07:00:00+11:00', end_time: '2026-01-23T15:00:00+11:00', hours: 40, cost: 8500 },
      { site_code: 'CA1', title: 'Quarterly Maintenance — Q4', location: 'All Electrical Infrastructure', category: 'Quarterly maintenance', description: 'Q4 preventative maintenance', start_time: '2026-04-20T07:00:00+10:00', end_time: '2026-04-24T15:00:00+10:00', hours: 40, cost: 8500 },
      { site_code: 'CA1', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management: PM scheduling, reporting, customer meetings, documentation', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 24, cost: 0 },
      { site_code: 'CA1', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management: PM scheduling, reporting, customer meetings', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 24, cost: 0 },
      { site_code: 'CA1', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 24, cost: 0 },
      { site_code: 'CA1', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 24, cost: 0 },

      // === SY1 — 639 Gardeners Rd Mascot ===
      { site_code: 'SY1', title: 'Thermal Scanning — HV & LV', location: 'HV Room, MCC Room 1 & 2', category: 'Thermal scanning', description: 'Bi-annual thermal scan of all HV and LV switchgear. Contractor: ThermoTech', start_time: '2025-09-08T08:00:00+10:00', end_time: '2025-09-09T16:00:00+10:00', hours: 16, cost: 4200 },
      { site_code: 'SY1', title: 'Thermal Scanning — HV & LV', location: 'HV Room, MCC Room 1 & 2', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2026-03-09T08:00:00+11:00', end_time: '2026-03-10T16:00:00+11:00', hours: 16, cost: 4200 },
      { site_code: 'SY1', title: 'Dark Site Test', location: 'Entire Facility', category: 'Dark site test', description: 'Annual dark site (black start) test. Full facility power down, generator start, UPS transfer, load restoration sequence. Coordinate with Equinix ops 4 weeks prior.', start_time: '2025-11-15T22:00:00+11:00', end_time: '2025-11-16T06:00:00+11:00', hours: 8, cost: 12000 },
      { site_code: 'SY1', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting duration test', start_time: '2025-08-25T06:00:00+10:00', end_time: '2025-08-25T14:00:00+10:00', hours: 8, cost: 1600 },
      { site_code: 'SY1', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting duration test', start_time: '2026-02-23T06:00:00+11:00', end_time: '2026-02-23T14:00:00+11:00', hours: 8, cost: 1600 },
      { site_code: 'SY1', title: 'RCD Testing', location: 'All DBs', category: 'RCD testing', description: 'Annual RCD testing per AS/NZS 3760', start_time: '2025-10-06T07:00:00+11:00', end_time: '2025-10-06T15:00:00+11:00', hours: 8, cost: 2200 },
      { site_code: 'SY1', title: 'Test and Tag', location: 'Office, NOC, Common Areas', category: 'Test and tagging', description: 'Annual test and tag', start_time: '2026-01-12T08:00:00+11:00', end_time: '2026-01-12T16:00:00+11:00', hours: 8, cost: 1100 },
      { site_code: 'SY1', title: 'Quarterly Maintenance — Q1', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q1 PM round', start_time: '2025-07-21T07:00:00+10:00', end_time: '2025-07-25T15:00:00+10:00', hours: 40, cost: 9200 },
      { site_code: 'SY1', title: 'Quarterly Maintenance — Q2', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q2 PM round', start_time: '2025-10-27T07:00:00+11:00', end_time: '2025-10-31T15:00:00+11:00', hours: 40, cost: 9200 },
      { site_code: 'SY1', title: 'Quarterly Maintenance — Q3', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q3 PM round', start_time: '2026-02-02T07:00:00+11:00', end_time: '2026-02-06T15:00:00+11:00', hours: 40, cost: 9200 },
      { site_code: 'SY1', title: 'Quarterly Maintenance — Q4', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q4 PM round', start_time: '2026-05-04T07:00:00+10:00', end_time: '2026-05-08T15:00:00+10:00', hours: 40, cost: 9200 },
      { site_code: 'SY1', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management hours', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 32, cost: 0 },
      { site_code: 'SY1', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management hours', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 32, cost: 0 },
      { site_code: 'SY1', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management hours', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 32, cost: 0 },
      { site_code: 'SY1', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management hours', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 32, cost: 0 },

      // === SY2 — 639 Gardeners Rd Mascot ===
      { site_code: 'SY2', title: 'Thermal Scanning — All Switchgear', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2025-09-15T08:00:00+10:00', end_time: '2025-09-16T16:00:00+10:00', hours: 16, cost: 4200 },
      { site_code: 'SY2', title: 'Thermal Scanning — All Switchgear', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2026-03-16T08:00:00+11:00', end_time: '2026-03-17T16:00:00+11:00', hours: 16, cost: 4200 },
      { site_code: 'SY2', title: 'Dark Site Test', location: 'Entire Facility', category: 'Dark site test', description: 'Annual dark site test. Full power down and restoration. 4 weeks advance coordination.', start_time: '2026-03-28T22:00:00+11:00', end_time: '2026-03-29T06:00:00+11:00', hours: 8, cost: 14000 },
      { site_code: 'SY2', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2025-08-11T06:00:00+10:00', end_time: '2025-08-11T14:00:00+10:00', hours: 8, cost: 1600 },
      { site_code: 'SY2', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2026-02-09T06:00:00+11:00', end_time: '2026-02-09T14:00:00+11:00', hours: 8, cost: 1600 },
      { site_code: 'SY2', title: 'Lightning Protection Testing', location: 'Roof / External', category: 'Lightning protection testing', description: 'Annual lightning protection test', start_time: '2025-11-03T07:00:00+11:00', end_time: '2025-11-03T15:00:00+11:00', hours: 8, cost: 3400 },
      { site_code: 'SY2', title: 'RCD Testing', location: 'All DBs', category: 'RCD testing', description: 'Annual RCD testing', start_time: '2025-12-01T07:00:00+11:00', end_time: '2025-12-01T15:00:00+11:00', hours: 8, cost: 2200 },
      { site_code: 'SY2', title: 'Test and Tag', location: 'Office & Common', category: 'Test and tagging', description: 'Annual test and tag', start_time: '2026-01-19T08:00:00+11:00', end_time: '2026-01-19T16:00:00+11:00', hours: 8, cost: 1100 },
      { site_code: 'SY2', title: 'Quarterly Maintenance — Q1', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q1 PM round', start_time: '2025-08-04T07:00:00+10:00', end_time: '2025-08-08T15:00:00+10:00', hours: 40, cost: 9800 },
      { site_code: 'SY2', title: 'Quarterly Maintenance — Q2', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q2 PM round', start_time: '2025-11-10T07:00:00+11:00', end_time: '2025-11-14T15:00:00+11:00', hours: 40, cost: 9800 },
      { site_code: 'SY2', title: 'Quarterly Maintenance — Q3', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q3 PM round', start_time: '2026-02-16T07:00:00+11:00', end_time: '2026-02-20T15:00:00+11:00', hours: 40, cost: 9800 },
      { site_code: 'SY2', title: 'Quarterly Maintenance — Q4', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q4 PM round', start_time: '2026-05-18T07:00:00+10:00', end_time: '2026-05-22T15:00:00+10:00', hours: 40, cost: 9800 },
      { site_code: 'SY2', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 32, cost: 0 },
      { site_code: 'SY2', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 32, cost: 0 },
      { site_code: 'SY2', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 32, cost: 0 },
      { site_code: 'SY2', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 32, cost: 0 },
      { site_code: 'SY2', title: 'WO — Switchboard Mod B2-MSB', location: 'B2 Main Switchboard', category: 'WOs', description: 'Install new 630A ACB feeder for customer expansion. Materials: ABB Emax E2 630A, cabling, busbars.', start_time: '2026-01-26T07:00:00+11:00', end_time: '2026-01-30T15:00:00+11:00', hours: 40, cost: 28500 },

      // === SY3 — 47 Bourke Rd Alexandria ===
      { site_code: 'SY3', title: 'Thermal Scanning', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2025-08-04T08:00:00+10:00', end_time: '2025-08-04T16:00:00+10:00', hours: 8, cost: 2800 },
      { site_code: 'SY3', title: 'Thermal Scanning', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2026-02-02T08:00:00+11:00', end_time: '2026-02-02T16:00:00+11:00', hours: 8, cost: 2800 },
      { site_code: 'SY3', title: 'Dark Site Test', location: 'Entire Facility', category: 'Dark site test', description: 'Annual dark site test', start_time: '2026-02-28T22:00:00+11:00', end_time: '2026-03-01T06:00:00+11:00', hours: 8, cost: 10000 },
      { site_code: 'SY3', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2025-09-01T06:00:00+10:00', end_time: '2025-09-01T14:00:00+10:00', hours: 8, cost: 1200 },
      { site_code: 'SY3', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2026-03-02T06:00:00+11:00', end_time: '2026-03-02T14:00:00+11:00', hours: 8, cost: 1200 },
      { site_code: 'SY3', title: 'RCD Testing', location: 'All DBs', category: 'RCD testing', description: 'Annual RCD testing', start_time: '2025-10-20T07:00:00+11:00', end_time: '2025-10-20T15:00:00+11:00', hours: 8, cost: 1800 },
      { site_code: 'SY3', title: 'Test and Tag', location: 'All Areas', category: 'Test and tagging', description: 'Annual test and tag', start_time: '2025-11-24T08:00:00+11:00', end_time: '2025-11-24T16:00:00+11:00', hours: 8, cost: 900 },
      { site_code: 'SY3', title: 'Quarterly Maintenance — Q1', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q1 PM round', start_time: '2025-07-28T07:00:00+10:00', end_time: '2025-08-01T15:00:00+10:00', hours: 40, cost: 7800 },
      { site_code: 'SY3', title: 'Quarterly Maintenance — Q2', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q2 PM round', start_time: '2025-11-03T07:00:00+11:00', end_time: '2025-11-07T15:00:00+11:00', hours: 40, cost: 7800 },
      { site_code: 'SY3', title: 'Quarterly Maintenance — Q3', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q3 PM round', start_time: '2026-01-26T07:00:00+11:00', end_time: '2026-01-30T15:00:00+11:00', hours: 40, cost: 7800 },
      { site_code: 'SY3', title: 'Quarterly Maintenance — Q4', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q4 PM round', start_time: '2026-04-27T07:00:00+10:00', end_time: '2026-05-01T15:00:00+10:00', hours: 40, cost: 7800 },
      { site_code: 'SY3', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 20, cost: 0 },
      { site_code: 'SY3', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 20, cost: 0 },
      { site_code: 'SY3', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 20, cost: 0 },
      { site_code: 'SY3', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 20, cost: 0 },

      // === SY6 — 8-14 Egerton St Silverwater ===
      { site_code: 'SY6', title: 'Thermal Scanning — Full Site', location: 'All Switch Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan — largest Equinix NSW site. Allow 3 days.', start_time: '2025-09-22T08:00:00+10:00', end_time: '2025-09-24T16:00:00+10:00', hours: 24, cost: 6800 },
      { site_code: 'SY6', title: 'Thermal Scanning — Full Site', location: 'All Switch Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2026-03-23T08:00:00+11:00', end_time: '2026-03-25T16:00:00+11:00', hours: 24, cost: 6800 },
      { site_code: 'SY6', title: 'Dark Site Test', location: 'Entire Facility', category: 'Dark site test', description: 'Annual dark site test. Critical facility — extensive planning required. 6 weeks coordination lead time.', start_time: '2025-10-18T22:00:00+11:00', end_time: '2025-10-19T08:00:00+11:00', hours: 10, cost: 18000 },
      { site_code: 'SY6', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting — large site, 2 days required', start_time: '2025-08-18T06:00:00+10:00', end_time: '2025-08-19T14:00:00+10:00', hours: 16, cost: 2800 },
      { site_code: 'SY6', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting', start_time: '2026-02-16T06:00:00+11:00', end_time: '2026-02-17T14:00:00+11:00', hours: 16, cost: 2800 },
      { site_code: 'SY6', title: 'Lightning Protection Testing', location: 'Roof / External', category: 'Lightning protection testing', description: 'Annual lightning protection test', start_time: '2025-11-17T07:00:00+11:00', end_time: '2025-11-17T15:00:00+11:00', hours: 8, cost: 3600 },
      { site_code: 'SY6', title: 'RCD Testing', location: 'All DBs', category: 'RCD testing', description: 'Annual RCD testing — large site, allow 2 days', start_time: '2025-12-08T07:00:00+11:00', end_time: '2025-12-09T15:00:00+11:00', hours: 16, cost: 3800 },
      { site_code: 'SY6', title: 'Test and Tag', location: 'All Areas', category: 'Test and tagging', description: 'Annual test and tag', start_time: '2026-02-02T08:00:00+11:00', end_time: '2026-02-02T16:00:00+11:00', hours: 8, cost: 1400 },
      { site_code: 'SY6', title: 'Quarterly Maintenance — Q1', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q1 PM round — largest site, 2 week block', start_time: '2025-07-07T07:00:00+10:00', end_time: '2025-07-18T15:00:00+10:00', hours: 80, cost: 18500 },
      { site_code: 'SY6', title: 'Quarterly Maintenance — Q2', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q2 PM round', start_time: '2025-10-06T07:00:00+11:00', end_time: '2025-10-17T15:00:00+11:00', hours: 80, cost: 18500 },
      { site_code: 'SY6', title: 'Quarterly Maintenance — Q3', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q3 PM round', start_time: '2026-01-05T07:00:00+11:00', end_time: '2026-01-16T15:00:00+11:00', hours: 80, cost: 18500 },
      { site_code: 'SY6', title: 'Quarterly Maintenance — Q4', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q4 PM round', start_time: '2026-04-06T07:00:00+10:00', end_time: '2026-04-17T15:00:00+10:00', hours: 80, cost: 18500 },
      { site_code: 'SY6', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 40, cost: 0 },
      { site_code: 'SY6', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 40, cost: 0 },
      { site_code: 'SY6', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 40, cost: 0 },
      { site_code: 'SY6', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 40, cost: 0 },
      { site_code: 'SY6', title: 'WO — UPS Battery Replacement Hall A', location: 'UPS Room A', category: 'WOs', description: 'Replace UPS battery strings in Hall A. 4 x battery cabinets. Coordinate with customer for load transfer.', start_time: '2026-03-09T07:00:00+11:00', end_time: '2026-03-13T15:00:00+11:00', hours: 40, cost: 45000 },

      // === SY7 — 8-14 Egerton St Silverwater ===
      { site_code: 'SY7', title: 'Thermal Scanning', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2025-09-29T08:00:00+10:00', end_time: '2025-09-29T16:00:00+10:00', hours: 8, cost: 2800 },
      { site_code: 'SY7', title: 'Thermal Scanning', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2026-03-30T08:00:00+11:00', end_time: '2026-03-30T16:00:00+11:00', hours: 8, cost: 2800 },
      { site_code: 'SY7', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2025-09-08T06:00:00+10:00', end_time: '2025-09-08T14:00:00+10:00', hours: 8, cost: 1200 },
      { site_code: 'SY7', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2026-03-09T06:00:00+11:00', end_time: '2026-03-09T14:00:00+11:00', hours: 8, cost: 1200 },
      { site_code: 'SY7', title: 'RCD Testing', location: 'All DBs', category: 'RCD testing', description: 'Annual RCD testing', start_time: '2025-11-24T07:00:00+11:00', end_time: '2025-11-24T15:00:00+11:00', hours: 8, cost: 1800 },
      { site_code: 'SY7', title: 'Test and Tag', location: 'All Areas', category: 'Test and tagging', description: 'Annual test and tag', start_time: '2026-01-05T08:00:00+11:00', end_time: '2026-01-05T16:00:00+11:00', hours: 8, cost: 900 },
      { site_code: 'SY7', title: 'Quarterly Maintenance — Q1', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q1 PM round', start_time: '2025-08-11T07:00:00+10:00', end_time: '2025-08-15T15:00:00+10:00', hours: 40, cost: 8200 },
      { site_code: 'SY7', title: 'Quarterly Maintenance — Q2', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q2 PM round', start_time: '2025-11-17T07:00:00+11:00', end_time: '2025-11-21T15:00:00+11:00', hours: 40, cost: 8200 },
      { site_code: 'SY7', title: 'Quarterly Maintenance — Q3', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q3 PM round', start_time: '2026-02-09T07:00:00+11:00', end_time: '2026-02-13T15:00:00+11:00', hours: 40, cost: 8200 },
      { site_code: 'SY7', title: 'Quarterly Maintenance — Q4', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q4 PM round', start_time: '2026-05-11T07:00:00+10:00', end_time: '2026-05-15T15:00:00+10:00', hours: 40, cost: 8200 },
      { site_code: 'SY7', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 20, cost: 0 },
      { site_code: 'SY7', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 20, cost: 0 },
      { site_code: 'SY7', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 20, cost: 0 },
      { site_code: 'SY7', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 20, cost: 0 },

      // === SY9 — 17-23 Egerton St Silverwater ===
      { site_code: 'SY9', title: 'Thermal Scanning', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2025-10-06T08:00:00+11:00', end_time: '2025-10-06T16:00:00+11:00', hours: 8, cost: 2800 },
      { site_code: 'SY9', title: 'Thermal Scanning', location: 'HV & LV Rooms', category: 'Thermal scanning', description: 'Bi-annual thermal scan', start_time: '2026-04-06T08:00:00+10:00', end_time: '2026-04-06T16:00:00+10:00', hours: 8, cost: 2800 },
      { site_code: 'SY9', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2025-10-13T06:00:00+11:00', end_time: '2025-10-13T14:00:00+11:00', hours: 8, cost: 1200 },
      { site_code: 'SY9', title: 'Emergency Lighting Test', location: 'All Areas', category: 'Emergency lighting', description: '6-monthly emergency lighting test', start_time: '2026-04-13T06:00:00+10:00', end_time: '2026-04-13T14:00:00+10:00', hours: 8, cost: 1200 },
      { site_code: 'SY9', title: 'RCD Testing', location: 'All DBs', category: 'RCD testing', description: 'Annual RCD testing', start_time: '2025-12-15T07:00:00+11:00', end_time: '2025-12-15T15:00:00+11:00', hours: 8, cost: 1800 },
      { site_code: 'SY9', title: 'Test and Tag', location: 'All Areas', category: 'Test and tagging', description: 'Annual test and tag', start_time: '2026-02-23T08:00:00+11:00', end_time: '2026-02-23T16:00:00+11:00', hours: 8, cost: 900 },
      { site_code: 'SY9', title: 'Quarterly Maintenance — Q1', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q1 PM round', start_time: '2025-08-25T07:00:00+10:00', end_time: '2025-08-29T15:00:00+10:00', hours: 40, cost: 8200 },
      { site_code: 'SY9', title: 'Quarterly Maintenance — Q2', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q2 PM round', start_time: '2025-12-01T07:00:00+11:00', end_time: '2025-12-05T15:00:00+11:00', hours: 40, cost: 8200 },
      { site_code: 'SY9', title: 'Quarterly Maintenance — Q3', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q3 PM round', start_time: '2026-02-23T07:00:00+11:00', end_time: '2026-02-27T15:00:00+11:00', hours: 40, cost: 8200 },
      { site_code: 'SY9', title: 'Quarterly Maintenance — Q4', location: 'All Electrical', category: 'Quarterly maintenance', description: 'Q4 PM round', start_time: '2026-05-25T07:00:00+10:00', end_time: '2026-05-29T15:00:00+10:00', hours: 40, cost: 8200 },
      { site_code: 'SY9', title: 'Management — Q1', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-07-01T08:00:00+10:00', end_time: '2025-09-30T17:00:00+10:00', hours: 20, cost: 0 },
      { site_code: 'SY9', title: 'Management — Q2', location: 'Office', category: 'Management', description: 'Site management', start_time: '2025-10-01T08:00:00+11:00', end_time: '2025-12-31T17:00:00+11:00', hours: 20, cost: 0 },
      { site_code: 'SY9', title: 'Management — Q3', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-01-01T08:00:00+11:00', end_time: '2026-03-31T17:00:00+11:00', hours: 20, cost: 0 },
      { site_code: 'SY9', title: 'Management — Q4', location: 'Office', category: 'Management', description: 'Site management', start_time: '2026-04-01T08:00:00+10:00', end_time: '2026-06-30T17:00:00+10:00', hours: 20, cost: 0 },
    ]

    // Build insert rows — skip entries where site not found
    const rows = []
    const skipped: string[] = []

    for (const entry of seedEntries) {
      const site = findSite(entry.site_code)
      if (!site) {
        skipped.push(entry.site_code)
        continue
      }
      const { quarter, financial_year } = computeAuFyQuarter(entry.start_time)
      rows.push({
        tenant_id: tenantId,
        site_id: site.id,
        title: entry.title,
        location: entry.location,
        description: entry.description,
        category: entry.category,
        start_time: entry.start_time,
        end_time: entry.end_time,
        hours: entry.hours,
        contractor_materials_cost: entry.cost,
        quarter,
        financial_year,
        status: 'scheduled',
      })
    }

    if (rows.length === 0) {
      return { success: false, error: `No matching sites found. Looked for: CA1, SY1, SY2, SY3, SY6, SY7, SY9. Available: ${sites.map(s => s.code || s.name).join(', ')}` }
    }

    // Insert in batches of 50
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50)
      const { error } = await supabase.from('pm_calendar').insert(batch)
      if (error) return { success: false, error: `Batch insert failed: ${error.message}` }
    }

    const uniqueSkipped = [...new Set(skipped)]
    const msg = `Seeded ${rows.length} PM calendar entries.${uniqueSkipped.length > 0 ? ` Skipped sites not found: ${uniqueSkipped.join(', ')}` : ''}`

    await logAuditEvent({ action: 'create', entityType: 'pm_calendar', summary: msg })
    revalidatePath('/pm-calendar')
    return { success: true, message: msg }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
