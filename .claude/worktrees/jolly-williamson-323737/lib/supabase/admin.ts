import { createClient } from '@supabase/supabase-js'
import { publicEnv, serverEnv } from '@/lib/env'

/**
 * Server-only Supabase client with the service role key. Bypasses RLS.
 * NEVER import this into a client component or expose the key to the browser.
 */
export function createAdminClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
