import Link from 'next/link'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Reset password</h1>
        <p className="text-sm text-eq-grey mt-1">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      <ForgotPasswordForm />
      <div className="text-center">
        <Link
          href="/auth/signin"
          className="text-sm text-eq-deep hover:text-eq-sky transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
