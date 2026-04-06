import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16 renamed `middleware.ts` → `proxy.ts` with a `proxy()` export.
// This file refreshes the Supabase session on every request, enforces
// authentication, MFA (AAL2), and admin-only routes.

const PUBLIC_PATHS = [
  '/auth/signin',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback',
]

const MFA_PATHS = ['/auth/mfa', '/auth/enroll-mfa']
// Paths an authenticated user can reach without completing MFA.
const AAL_EXEMPT_PATHS = ['/auth/mfa', '/auth/enroll-mfa', '/auth/reset-password', '/auth/signout']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const { response, supabase, user, aal } = await updateSession(request)

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isMfaPath = MFA_PATHS.some((p) => pathname.startsWith(p))
  const isAalExempt = AAL_EXEMPT_PATHS.some((p) => pathname.startsWith(p))

  // Unauthenticated users -> /auth/signin (except for public routes).
  if (!user) {
    if (isPublic) return response
    const url = request.nextUrl.clone()
    url.pathname = '/auth/signin'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // Authenticated users on public auth pages -> dashboard.
  if (isPublic && aal.currentLevel === 'aal2') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // AAL enforcement:
  //   nextLevel === 'aal2' && currentLevel === 'aal1'  -> must challenge existing factor
  //   nextLevel === 'aal1' && currentLevel === 'aal1'  -> no factor enrolled yet
  if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2' && !isAalExempt) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/mfa'
    return NextResponse.redirect(url)
  }

  if (
    aal.currentLevel === 'aal1' &&
    aal.nextLevel === 'aal1' &&
    !isAalExempt
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/enroll-mfa'
    return NextResponse.redirect(url)
  }

  // Admin-only routes.
  if (pathname.startsWith('/admin')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (!profile || !['super_admin', 'admin'].includes(profile.role) || !profile.is_active) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  // Deactivated users are signed out on any protected route.
  if (!isPublic && !isAalExempt) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', user.id)
      .single()
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/auth/signin'
      url.searchParams.set('error', 'deactivated')
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Match all paths except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
