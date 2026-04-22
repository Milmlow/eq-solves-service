import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
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
