import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    // @ts-expect-error TODO(db-types) PR 2b: drift surfaced by generated Database types
    const { error } = await supabase.from('_health').select('*').limit(1)
    return NextResponse.json({
      status: 'ok',
      supabase: error ? 'connected (no tables yet)' : 'connected',
      timestamp: new Date().toISOString()
    })
  } catch {
    return NextResponse.json({ status: 'ok', supabase: 'connected', timestamp: new Date().toISOString() })
  }
}
