// Global TypeScript types for EQ Solves Service

export type Role = 'super_admin' | 'admin' | 'supervisor' | 'technician' | 'read_only'

export type ProfileRole = Role | 'user'

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'ad_hoc'

export interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TenantSettings {
  id: string
  tenant_id: string
  primary_colour: string
  deep_colour: string
  ice_colour: string
  ink_colour: string
  logo_url: string | null
  product_name: string
  support_email: string | null
  updated_at: string
}

export interface TenantMember {
  id: string
  tenant_id: string
  user_id: string
  role: Role
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: ProfileRole
  is_active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  tenant_id: string
  name: string
  code: string | null
  email: string | null
  phone: string | null
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Site {
  id: string
  tenant_id: string
  customer_id: string | null
  name: string
  code: string | null
  address: string | null
  city: string | null
  state: string | null
  postcode: string | null
  country: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Asset {
  id: string
  tenant_id: string
  site_id: string
  name: string
  asset_type: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  maximo_id: string | null
  install_date: string | null
  location: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface JobPlan {
  id: string
  tenant_id: string
  site_id: string
  name: string
  description: string | null
  frequency: Frequency
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface JobPlanItem {
  id: string
  tenant_id: string
  job_plan_id: string
  asset_id: string | null
  description: string
  sort_order: number
  is_required: boolean
  created_at: string
  updated_at: string
}

export interface ApiResponse<T> {
  data: T | null
  error: string | null
  meta?: PaginationMeta
}

export interface PaginationMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}
