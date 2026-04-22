/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 */
import { SignInForm } from './SignInForm'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const next = params.next || '/dashboard'
  const initialError = resolveInitialError(params.error)

  return <SignInForm next={next} initialError={initialError} />
}

/**
 * Map callback error query params to operator-friendly copy.
 * Unknown errors are surfaced verbatim (trimmed) so invite-link failures show
 * the real cause instead of vanishing behind a generic message.
 */
function resolveInitialError(error: string | undefined): string | undefined {
  if (!error) return undefined
  switch (error) {
    case 'deactivated':
      return 'Your account has been deactivated. Contact an administrator.'
    case 'demo_unavailable':
      return 'Demo is temporarily unavailable. Please try again shortly.'
    case 'invite_link_missing_token':
      return 'That invite link looks incomplete — ask your administrator to resend it.'
    case 'callback':
      return 'That link could not be used. Ask your administrator to resend the invite.'
    default:
      // Pass through error.message from the callback route (e.g. "Email link is invalid or has expired")
      return error.slice(0, 200)
  }
}
