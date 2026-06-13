// Sentry initialisation for the Node.js server runtime.
// Imported from instrumentation.ts when NEXT_RUNTIME === 'nodejs'.
// Server-side errors (server actions, route handlers, RSC fetches) are
// captured here.
//
// Keep this file at the project root, NOT under app/ or lib/, because the
// Next.js Sentry integration looks for it by exact path.

import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent as SentryEvent } from '@sentry/core'

// Collect T3 secret values at module load so beforeSend can scrub them from
// any event that accidentally captures an env var value in an error message,
// extra field, or breadcrumb. Values shorter than 10 chars are excluded to
// avoid false-positive matches on common substrings.
const T3_VALUES: string[] = [
  process.env.EQ_SECRET_SALT,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_JWT_SECRET,
  process.env.EQ_SERVICE_JWT_SECRET,
  process.env.EQ_PLATFORM_ADMIN_KEY,
  process.env.CRON_SECRET,
  process.env.SITE_CREDENTIALS_KEY,
  process.env.UNSUBSCRIBE_SECRET,
  process.env.AUDIT_SB_KEY,
  process.env.CANONICAL_API_KEY_SERVICE,
].filter((v): v is string => typeof v === 'string' && v.length >= 10)

function scrubT3(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value
    for (const secret of T3_VALUES) {
      if (out.includes(secret)) out = out.split(secret).join('[T3:SCRUBBED]')
    }
    return out
  }
  if (Array.isArray(value)) return value.map(scrubT3)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubT3(v)])
    )
  }
  return value
}

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample 100% of errors. Volume is low at current tenant count; revisit
  // when monthly errors approach the Sentry free-tier cap (5k events/month).
  tracesSampleRate: 0,

  // Replay sampling is client-only; not used here. See sentry.client.config.
  // Profiling is opt-in via @sentry/profiling-node; not enabled.

  // Tag every event with the environment so the Sentry UI can filter
  // production vs preview deploys vs local. Netlify sets CONTEXT
  // (production / deploy-preview / branch-deploy) automatically.
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.CONTEXT ?? 'production',

  // Source-map upload is wired in next.config.ts; releases auto-tagged
  // by the @sentry/nextjs plugin from the Netlify commit SHA.

  // Don't pollute the dashboard with local dev errors.
  enabled: process.env.NODE_ENV === 'production',

  // Common server-side noise filters. Add specific patterns as we see
  // them in the dashboard.
  ignoreErrors: [
    // PostgREST often returns 'No rows found' as an error shape via
    // maybeSingle() — we handle these inline, they aren't real errors.
    /PGRST116/,
  ],

  // Strip T3 secret values from all event payloads before sending.
  beforeSend: (event: SentryEvent) => scrubT3(event) as SentryEvent,
})
