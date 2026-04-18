import { z } from 'zod'

/**
 * Environment variable validation.
 *
 * Server-side variables are validated on first use (lazy singleton).
 * Public variables are validated at module load time since they're
 * inlined by the bundler.
 *
 * If any variable is missing or malformed the app will throw at startup
 * rather than failing silently at runtime.
 */

// --- Public (browser-safe) ---

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
})

function validatePublicEnv() {
  const result = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  if (!result.success) {
    const formatted = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`❌ Invalid public environment variables:\n${formatted}`)
  }
  return result.data
}

export const publicEnv = validatePublicEnv()

// --- Server-only ---

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
})

let _serverEnv: z.infer<typeof serverSchema> | null = null

export function serverEnv() {
  if (_serverEnv) return _serverEnv
  const result = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })
  if (!result.success) {
    const formatted = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`❌ Invalid server environment variables:\n${formatted}`)
  }
  _serverEnv = result.data
  return _serverEnv
}
