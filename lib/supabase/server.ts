import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { publicEnv } from '@/lib/env'
import type { Database } from './database.types'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            // SameSite=None required in production — see lib/supabase/middleware.ts
            const sameSiteOverride = process.env.NODE_ENV === 'production'
              ? { sameSite: 'none' as const, secure: true }
              : {}
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...sameSiteOverride })
            )
          } catch {}
        },
      },
    }
  )
}
