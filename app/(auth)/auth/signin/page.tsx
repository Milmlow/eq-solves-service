import Link from 'next/link'
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
      : undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Sign in</h1>
        <p className="text-sm text-eq-grey mt-1">
          Enter your credentials to continue.
        </p>
      </div>
      <SignInForm next={next} initialError={initialError} />
      <div className="text-center">
        <Link
          href="/auth/forgot-password"
          className="text-sm text-eq-deep hover:text-eq-sky transition-colors"
        >
          Forgot password?
        </Link>
      </div>
    </div>
  )
}
