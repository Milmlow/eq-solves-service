import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client with the service role key. Bypasses RLS.
 * NEVER import this into a client component or expose the key to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase service-role env vars are missing.')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
