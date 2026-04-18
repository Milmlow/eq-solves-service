import { ResetPasswordForm } from './ResetPasswordForm'

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Set a new password</h1>
        <p className="text-sm text-eq-grey mt-1">
          Choose a password of at least 10 characters.
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  )
}
