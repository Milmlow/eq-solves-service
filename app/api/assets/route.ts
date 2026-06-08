import { NextRequest } from 'next/server'
import { getApiUser, isAdmin } from '@/lib/api/auth'
import { ok, created, err, unauthorized, forbidden } from '@/lib/api/response'
import { parsePagination, paginationMeta } from '@/lib/api/pagination'
import { CreateAssetSchema } from '@/lib/validations/asset'

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
    const siteId = request.nextUrl.searchParams.get('site_id')

    let countQuery = appDataFrom(supabase, 'assets')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('active', true)

    if (siteId) {
      countQuery = countQuery.eq('site_id', siteId)
    }

    const { count } = await countQuery

    let dataQuery = appDataFrom(supabase, 'assets')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name', { ascending: true })

    if (siteId) {
      dataQuery = dataQuery.eq('site_id', siteId)
    }

    const { data, error } = await dataQuery.range(from, to)

    if (error) throw error
    return ok(data, paginationMeta(page, per_page, count || 0))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to fetch assets')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, role, supabase } = await getApiUser()
    if (!user) return unauthorized()
    if (!tenantId) return forbidden()
    if (!isAdmin(role)) return forbidden()

    const body = await request.json()
    const validated = CreateAssetSchema.parse(body)

    const { data, error } = await appDataFrom(supabase, 'assets')
      .insert([{ ...validated, tenant_id: tenantId, active: true }])
      .select()
      .single()

    if (error) throw error
    return created(data)
  } catch (error) {
    if (error instanceof Error && error.message.includes('validation')) {
      return err('Invalid input', 400)
    }
    return err(error instanceof Error ? error.message : 'Failed to create asset')
  }
}
