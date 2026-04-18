import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/db'

// Prefer runtime config (window.__EQ_CONFIG__) so keys can be rotated without
// rebuilding. Fall back to build-time env vars for local dev.
declare global {
  interface Window {
    __EQ_CONFIG__?: { supabaseUrl?: string; supabaseAnonKey?: string }
  }
}

const runtime = typeof window !== 'undefined' ? window.__EQ_CONFIG__ ?? {} : {}
const url = runtime.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string)
const anon = runtime.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string)

if (!url || !anon || anon === 'REPLACE_ME_WITH_ANON_KEY') {
  console.error('Missing Supabase config — edit /config.js on the deployed site.')
}

export const supabase = createClient<Database>(url ?? '', anon ?? '', {
  auth: { persistSession: false },
  global: { fetch: (...args) => fetch(...args) },
})
