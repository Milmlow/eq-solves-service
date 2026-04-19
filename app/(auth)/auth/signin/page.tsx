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
  const initialError =
    params.error === 'deactivated'
      ? 'Your account has been deactivated. Contact an administrator.'
      : params.error === 'demo_unavailable'
        ? 'Demo is temporarily unavailable. Please try again shortly.'
        : undefined

  return <SignInForm next={next} initialError={initialError} />
}
