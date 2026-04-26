// Domain types used across the app.

export type DataType = 'LOV' | 'NUM' | 'FREETEXT' | 'DATE' | 'CURRENCY' | 'AUTOFILLED'

export interface SiteContact {
  role: string
  name: string
  phone?: string | null
  email?: string | null
}

export interface Site {
  site_code: string
  display_name: string | null
  drawing_path: string | null
  contacts: SiteContact[]
  notes: string | null
  updated_at: string
}

export interface Classification {
  code: string
  description: string | null
  failure_class: string | null
  life_expectancy: number | null
  cost_parent_id: string | null
  aux_id: string | null
  notes: string | null
}

export interface ClassificationField {
  id: number
  classification_code: string
  spec_id: string
  display_name: string
  definition: string | null
  sample_values: string | null
  data_type: DataType
  display_order: number
  is_field_captured: boolean
  group: string | null
  options: string[]
}

export interface Job {
  id: string
  slug: string | null
  site_code: string // SY6, SY3 etc
  client_code: string // generic, e.g. DCCA
  classification_code: string
  name: string | null
  template_filename: string | null
  created_at: string
  active: boolean
}

export interface Asset {
  id: string
  job_id: string
  row_number: number
  asset_uid: string | null
  asset_id: string | null
  description: string
  classification_code: string
  location_id: string | null
  location_description: string | null
  manufacturer: string | null
  model: string | null
  serial: string | null
  source_row: Record<string, unknown>
}

export type CaptureSource = 'web' | 'file_reimport'

export interface Capture {
  id?: string
  asset_id: string
  classification_field_id: number
  value: string | null
  captured_by: string | null
  captured_at: string
  flagged: boolean
  notes: string | null
  source: CaptureSource
  source_file: string | null
}

// Supabase DB shape — wide types for now; tightened per-table once DDL lands
export interface Database {
  public: {
    Tables: {
      classifications: { Row: Classification; Insert: Classification; Update: Partial<Classification> }
      classification_fields: {
        Row: ClassificationField
        Insert: Omit<ClassificationField, 'id'>
        Update: Partial<ClassificationField>
      }
      jobs: { Row: Job; Insert: Omit<Job, 'id' | 'created_at'>; Update: Partial<Job> }
      assets: { Row: Asset; Insert: Omit<Asset, 'id'>; Update: Partial<Asset> }
      captures: { Row: Capture & { id: string }; Insert: Capture; Update: Partial<Capture> }
    }
  }
}
