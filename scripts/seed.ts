/**
 * Seed script: populates Supabase with
 *  - all 32 classifications (from the Equinix template)
 *  - all classification_fields per classification
 *  - one job (SY6 BREAKER) + its 101 assets
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in VITE_SUPABASE_URL +
 *      SUPABASE_SERVICE_ROLE_KEY (service role — NOT the anon key)
 *   2. npm run seed
 *
 * Safe to re-run: uses upsert semantics.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import 'dotenv/config'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

function readJson<T>(name: string): T {
  const p = path.resolve(__dirname, '..', 'src', 'data', name)
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
}

interface ClassificationRow {
  code: string
  description: string | null
  failure_class: string | null
  life_expectancy: number | null
  cost_parent_id: string | null
  aux_id: string | null
  notes: string | null
}

interface FieldJson {
  spec_id: string
  display_name: string
  definition: string | null
  sample_values: string | null
  data_type: string
  options: string[]
  display_order: number
  is_field_captured: boolean
  group: string | null
}

interface SchemaJson {
  [classificationCode: string]: {
    classification_code: string
    fields: FieldJson[]
    total_fields: number
    field_captured_count: number
  }
}

interface AssetJson {
  row_number: number
  asset_id: string | null
  description: string
  classification: string
  location_id: string | null
  location_description: string | null
  manufacturer: string | null
  model: string | null
  serial: string | null
  source_row: Record<string, unknown>
}

async function seed() {
  console.log('─── EQ Asset Capture — Seeding Supabase ───')

  // 1. Classifications
  const classifications = readJson<ClassificationRow[]>('classifications.json')
  console.log(`\n1. Upserting ${classifications.length} classifications...`)
  const { error: e1 } = await sb.from('classifications').upsert(classifications, {
    onConflict: 'code',
  })
  if (e1) throw e1
  console.log('   ✓ done')

  // 2. Classification fields
  const schema = readJson<SchemaJson>('classification_fields.json')
  const fieldRows: Array<{
    classification_code: string
    spec_id: string
    display_name: string
    definition: string | null
    sample_values: string | null
    data_type: string
    display_order: number
    is_field_captured: boolean
    field_group: string | null
    options: string[]
  }> = []
  for (const [code, data] of Object.entries(schema)) {
    for (const f of data.fields) {
      fieldRows.push({
        classification_code: code,
        spec_id: f.spec_id,
        display_name: f.display_name,
        definition: f.definition,
        sample_values: f.sample_values,
        data_type: f.data_type,
        display_order: f.display_order,
        is_field_captured: f.is_field_captured,
        field_group: f.group,
        options: f.options ?? [],
      })
    }
  }
  console.log(`\n2. Upserting ${fieldRows.length} classification_fields...`)
  const { error: e2 } = await sb.from('classification_fields').upsert(fieldRows, {
    onConflict: 'classification_code,spec_id',
  })
  if (e2) throw e2
  console.log('   ✓ done')

  // 3. SY6 BREAKER job
  console.log('\n3. Creating SY6 BREAKER job...')
  const { data: existingJob } = await sb
    .from('jobs')
    .select('id')
    .eq('site_code', 'SY6')
    .eq('classification_code', 'BREAKER')
    .eq('client_code', 'DCCA')
    .maybeSingle()

  let jobId: string
  if (existingJob?.id) {
    jobId = existingJob.id as string
    console.log(`   ↺ reusing existing job ${jobId}`)
  } else {
    const { data: newJob, error: e3 } = await sb
      .from('jobs')
      .insert({
        site_code: 'SY6',
        client_code: 'DCCA',
        classification_code: 'BREAKER',
        name: 'SY6 Breakers — Asset Capture',
        template_filename: 'SY6_-_BREAKER_New_Asset_Spreadsheet-130426.xlsm',
        active: true,
      })
      .select('id')
      .single()
    if (e3) throw e3
    jobId = newJob.id as string
    console.log(`   ✓ created job ${jobId}`)
  }

  // 4. Assets for the SY6 BREAKER job
  const sy6Assets = readJson<AssetJson[]>('sy6_assets.json')
  const breakerAssets = sy6Assets.filter((a) => a.classification === 'BREAKER')
  console.log(`\n4. Upserting ${breakerAssets.length} breaker assets...`)
  const assetRows = breakerAssets.map((a) => ({
    job_id: jobId,
    row_number: a.row_number,
    asset_id: a.asset_id,
    description: a.description,
    classification_code: 'BREAKER',
    location_id: a.location_id,
    location_description: a.location_description,
    manufacturer: a.manufacturer,
    model: a.model,
    serial: a.serial,
    source_row: a.source_row,
  }))
  const { error: e4 } = await sb.from('assets').upsert(assetRows, {
    onConflict: 'job_id,row_number',
  })
  if (e4) throw e4
  console.log('   ✓ done')

  console.log('\n─── Seed complete ───')
  console.log(`Job ID: ${jobId}`)
  console.log(`Field URL: /j/${jobId}`)
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
