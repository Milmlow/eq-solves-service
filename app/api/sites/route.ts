import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'
import { CreateSiteSchema } from '@/lib/validations/site'

// app_data schema is not in the generated Database type, so we cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function appDataFrom(supabase: any, table: string) {
  return supabase.schema('app_data').from(table)
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()

    const { page, per_page, from, to } = parsePagination(request.nextUrl.searchParams)
    const customerId = request.nextUrl.searchParams.get('customer_id')

    let countQuery = appDataFrom(supabase, 'sites')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true)

    if (customerId) {
      countQuery = countQuery.eq('customer_id', customerId)
    }

    const { count } = await countQuery

    let dataQuery = appDataFrom(supabase, 'sites')
      .select('site_id, name, code, client_name, site_type, address_line_1, suburb, state, postcode, customer_id, active, slug')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true })

    if (customerId) {
      dataQuery = dataQuery.eq('customer_id', customerId)
    }

    const { data, error } = await dataQuery.range(from, to)

    if (error) throw error
    const total = count || 0
    return ok(data, paginationMeta(page, per_page, total))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch sites')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateSiteSchema.parse(body)

    const { data, error } = await appDataFrom(supabase, 'sites')
      .insert([{ ...validated, tenant_id: tenantId, active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create site')
  }
}
