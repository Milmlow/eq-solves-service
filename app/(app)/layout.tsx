/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { Sidebar } from '@/components/ui/Sidebar'
import { HelpWidget } from '@/components/ui/HelpWidget'
import { EqFooter } from '@/components/ui/EqFooter'
import { DemoBanner } from '@/components/ui/DemoBanner'
import { AnalyticsIdentify } from '@/components/ui/AnalyticsIdentify'
import { ShellReadySignal } from '@/components/ui/ShellReadySignal'
import { NavigationProgress } from '@/components/ui/NavigationProgress'
import { AppProviders } from '@/components/ui/AppProviders'
import { OnboardingWizard } from './onboarding/OnboardingWizard'
import { MfaGraceBanner } from '@/components/ui/MfaGraceBanner'
import { NoTenantGate } from '@/components/ui/NoTenantGate'
import { createClient } from '@/lib/supabase/server'
import { verifyServiceJwt } from '@/lib/auth/service-jwt'
import { getTenantSettings } from '@/lib/tenant/getTenantSettings'
import { isDemoEmail } from '@/lib/utils/demo'
import type { Role } from '@/lib/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Read cookie store early — needed for both the JWT path below and isShellIframe further down.
  const cookieStore = await cookies()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // JWT path: Shell iframe sessions set eq_service_jwt (minted by /api/shell-auth fast-path)
  // instead of establishing a real Supabase auth session. The standard supabase.auth.getUser()
  // misses this cookie — read it directly, same as getApiUser() in lib/api/auth.ts.
  // ehow has no tenant_members, so we derive isAdmin/analyticsTenantId/analyticsRole from
  // JWT claims and skip the DB lookup entirely.
  const serviceJwtRaw = cookieStore.get('eq_service_jwt')?.value
  const jwtClaims = serviceJwtRaw ? verifyServiceJwt(serviceJwtRaw) : null
  const hasJwtSession = !!(jwtClaims?.app_metadata?.tenant_id && jwtClaims.app_metadata.eq_role)

  let isAdmin = false
  let showOnboarding = false
  let userName: string | null = null
  let tenantName: string | null = null
  // Captured for AnalyticsIdentify — client-side PostHog + Clarity identify
  // runs after render with these values, so the server-known tenant + role
  // are what appear in events (no race with client-side auth fetch).
  let analyticsTenantId: string | null = null
  let analyticsRole: string | null = null
  // PR J: drives the MFA-grace banner. Null = no grace timer started
  // (legacy / pre-migration) → banner doesn't render. Set = check elapsed.
  let mfaGraceStartedAt: string | null = null
  // Whether the user has an MFA factor enrolled. Banner only shows when
  // they don't (and they're still in grace).
  let mfaHasFactor = false
  if (user) {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    mfaHasFactor = data?.nextLevel === 'aal2'
  }

  if (user) {
    // Fetch ALL active memberships with their tenant's setup state.
    // Previously this used .limit(1) with no ordering, which made Postgres
    // return an arbitrary row — any admin with multiple memberships could
    // land on an un-onboarded tenant and get force-dropped into the
    // OnboardingWizard ("create your own project" screen).
    const { data: memberships } = await supabase
      .from('tenant_members')
      .select('role, tenant_id, created_at, tenants!inner(name, setup_completed_at)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    // No tenant membership → let the user record a pending access request
    // instead of a dead end. Admins action it via /admin/users (orphan attach).
    if (!memberships || memberships.length === 0) {
      const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient
      const { data: pending } = await db
        .from('access_requests')
        .select('created_at, note')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .maybeSingle()
      return (
        <NoTenantGate
          email={user.email ?? null}
          pending={(pending as { created_at: string; note: string | null } | null) ?? null}
        />
      )
    }

    if (memberships.length > 0) {
      // Prefer a tenant that is already onboarded; otherwise fall back to
      // the earliest-joined membership so the choice is at least deterministic.
      type MembershipRow = {
        role: string
        tenant_id: string
        created_at: string
        tenants: {
          name: string
          setup_completed_at: string | null
        } | null
      }
      const rows = memberships as unknown as MembershipRow[]
      const completed = rows.find((m) => m.tenants?.setup_completed_at)
      const membership = completed ?? rows[0]

      isAdmin = membership.role === 'manager'
      analyticsTenantId = membership.tenant_id
      analyticsRole = membership.role

      // Only show the onboarding wizard if EVERY tenant this user belongs to
      // is un-onboarded. A super_admin/admin attached to even one completed
      // tenant should never see the wizard again.
      if (isAdmin && !rows.some((m) => m.tenants?.setup_completed_at)) {
        showOnboarding = true
        tenantName = membership.tenants?.name ?? null
      }
    }

    // Get user profile name + MFA grace state (PR J — read once, used by
    // the MfaGraceBanner below).
    const { data: profile } = await supabase
      .from('profiles')
      // mfa_grace_started_at added in migration 0103; cast on read until
      // database.types.ts regenerates.
      .select('full_name, mfa_grace_started_at' as 'full_name')
      .eq('id', user.id)
      .maybeSingle()
    userName = profile?.full_name ?? null
    mfaGraceStartedAt = (profile as { mfa_grace_started_at?: string | null } | null)?.mfa_grace_started_at ?? null
  } else if (hasJwtSession && jwtClaims) {
    // JWT path: Shell iframe session via eq_service_jwt. No tenant_members on ehow —
    // read role and tenant directly from JWT claims.
    isAdmin = jwtClaims.app_metadata.eq_role === 'manager'
    analyticsRole = jwtClaims.app_metadata.eq_role ?? null
    analyticsTenantId = jwtClaims.app_metadata.tenant_id ?? null
    showOnboarding = false
  }

  const { settings } = await getTenantSettings()

  // Detect shell iframe sessions — set by /api/shell-auth after a successful
  // HMAC exchange. When true, strip standalone chrome (footer, help widget,
  // sign-out) and show an "Open in new tab" escape hatch instead.
  // cookieStore was read at the top of this function.
  const isShellIframe = cookieStore.get('eq_shell_bridge')?.value === '1'
  // Shell UUID for cross-app PostHog identity. Set by /api/shell-auth when the
  // bridge token carries shell_user_id (eq-shell PR #265). Falls back to email
  // so non-iframe sessions (direct login) stay unaffected.
  const shellUserId = cookieStore.get('eq_shell_user_id')?.value ?? null

  // Inject tenant colours as CSS custom properties — overrides :root defaults
  const tenantStyle = {
    '--eq-sky': settings.primary_colour,
    '--eq-deep': settings.deep_colour,
    '--eq-ice': settings.ice_colour,
    '--eq-ink': settings.ink_colour,
  } as React.CSSProperties

  // Demo banner — only for the public demo fixture user.
  const isDemoSession = isDemoEmail(user?.email)
  let demoShareUrl = '/demo'
  if (isDemoSession) {
    try {
      const h = await headers()
      const host = h.get('x-forwarded-host') ?? h.get('host')
      const proto = h.get('x-forwarded-proto') ?? 'https'
      if (host) demoShareUrl = `${proto}://${host}/demo`
    } catch {
      // Fall back to the relative link — copy still works, just without origin.
    }
  }

  return (
    <AppProviders>
    <div className="flex min-h-screen bg-gray-50" style={tenantStyle}>
      {/* Skip-navigation link (WCAG 2.4.1 — Q-W2-1/A5). Visually hidden
          until focused, then surfaces as the first tab stop so keyboard
          users can jump straight past the sidebar to the page content
          instead of tabbing through all 12 nav items on every load. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-eq-deep focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2"
      >
        Skip to content
      </a>
      <NavigationProgress />
      {/* Shell owns the nav chrome when embedded — hide Service's sidebar */}
      {!isShellIframe && (
        <Sidebar
          isAdmin={isAdmin}
          role={analyticsRole as Role | null}
          settings={settings}
          isShellIframe={isShellIframe}
        />
      )}
      <div className="flex flex-1 min-w-0 flex-col">
        {isDemoSession && <DemoBanner shareUrl={demoShareUrl} />}
        {/* MFA grace banner (PR J §B.1 / §5.4) — visible reminder during
            the 14-day enrollment window. Renders nothing when the user has
            a factor enrolled, when grace hasn't started, or when the grace
            window has expired (proxy.ts redirects to /auth/enroll-mfa
            before reaching here in that case). */}
        {!isDemoSession && (
          <MfaGraceBanner
            graceStartedAt={mfaGraceStartedAt}
            hasFactor={mfaHasFactor}
          />
        )}
        {/* Shell nav bar — replaces the hidden sidebar when Service is embedded
            in core.eq.solutions. Makes the action hub (/do) and key pages
            reachable without the sidebar. Only shown for non-apprentice roles. */}
        {isShellIframe && analyticsRole && analyticsRole !== 'apprentice' && (
          <nav className="shrink-0 flex items-center gap-1 px-4 py-2 bg-white border-b border-gray-100">
            <Link
              href="/do"
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-semibold text-eq-deep bg-eq-ice hover:bg-eq-sky hover:text-white transition-colors"
            >
              Do
            </Link>
            <Link href="/dashboard" className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors">
              Dashboard
            </Link>
            <Link href="/maintenance" className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors">
              Maintenance
            </Link>
            {analyticsRole !== 'employee' && (
              <Link href="/records" className="px-3 py-1.5 rounded-md text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                Records
              </Link>
            )}
          </nav>
        )}
        <main id="main-content" tabIndex={-1} className={`flex-1 min-w-0 px-4 py-4 lg:pt-8 lg:px-8 lg:py-8 focus:outline-none${isShellIframe ? '' : ' pt-18'}`}>
          {children}
        </main>
        {!isShellIframe && <EqFooter />}
      </div>
      {!isShellIframe && <HelpWidget />}
      {showOnboarding && (
        <OnboardingWizard userName={userName} companyName={tenantName} />
      )}
      <ShellReadySignal isShellIframe={isShellIframe} />
      {analyticsTenantId && analyticsRole && (
        <AnalyticsIdentify
          // Cross-app PostHog distinct_id. When Shell embeds Service via iframe,
          // eq_shell_user_id cookie carries the Shell canonical UUID (set by
          // /api/shell-auth from BridgeTokenPayload.shell_user_id, eq-shell PR #265).
          // Falls back to lowercased email (from Supabase session or JWT claims for
          // the iframe JWT path), then user/JWT sub as a last resort.
          userId={
            shellUserId
            ?? (user?.email?.toLowerCase())
            ?? (jwtClaims?.app_metadata?.email?.toLowerCase())
            ?? user?.id
            ?? jwtClaims?.sub
            ?? 'unknown'
          }
          tenantId={isDemoSession ? 'demo-fixture' : analyticsTenantId}
          role={analyticsRole}
          appEnv={isDemoSession ? 'demo' : (process.env.NEXT_PUBLIC_APP_ENV ?? 'beta')}
        />
      )}
    </div>
    </AppProviders>
  )
}
