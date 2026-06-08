import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'
import { CreateCustomerSchema } from '@/lib/validations/customer'

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

    const { count } = await appDataFrom(supabase, 'customers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true)

    const { data, error } = await appDataFrom(supabase, 'customers')
      .select('customer_id, company_name, first_name, last_name, email, phone, active')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('company_name', { ascending: true })
      .range(from, to)

    if (error) throw error
    return ok(data, paginationMeta(page, per_page, count || 0))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch customers')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateCustomerSchema.parse(body)

    const { data, error } = await appDataFrom(supabase, 'customers')
      .insert([{ ...validated, tenant_id: tenantId, active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create customer')
  }
}
