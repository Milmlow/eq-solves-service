// Sentry initialisation for the Edge runtime.
// Imported from instrumentation.ts when NEXT_RUNTIME === 'edge'.
// Edge errors (middleware/proxy.ts and any edge-runtime route handlers)
// are captured here. The proxy.ts MFA gate is the main edge surface
// in this project.

import * as Sentry from '@sentry/nextjs'

// Edge runtime only exposes a subset of env vars (those not stripped at
// build time), so most T3 values won't be populated here. Collect
// whatever is present so the scrub fires if a secret ever leaks into
// an error message from proxy.ts.
const T3_EDGE: string[] = [
  process.env.EQ_SECRET_SALT,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_JWT_SECRET,
  process.env.EQ_SERVICE_JWT_SECRET,
].filter((v): v is string => typeof v === 'string' && v.length >= 10)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrubEdge(value: any): any {
  if (typeof value === 'string') {
    let out = value
    for (const secret of T3_EDGE) {
      if (out.includes(secret)) out = out.split(secret).join('[T3:SCRUBBED]')
    }
    return out
  }
  if (Array.isArray(value)) return value.map(scrubEdge)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubEdge(v)])
    )
  }
  return value
}

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Edge runs are short-lived; tracing produces a lot of spans.
  // Keep at 0 until we have a specific perf question to answer.
  tracesSampleRate: 0,

  environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.CONTEXT ?? 'production',

  enabled: process.env.NODE_ENV === 'production',

  // Strip any T3 secret values that may appear in edge error payloads.
  beforeSend: scrubEdge,
})
