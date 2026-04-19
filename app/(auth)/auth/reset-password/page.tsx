import { ResetPasswordForm } from './ResetPasswordForm'

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-eq-deep bg-eq-ice px-2 py-1 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-eq-sky" />
          Password reset
        </span>
        <h1 className="text-2xl font-bold text-eq-ink tracking-tight mt-4 leading-tight">
          Choose a new password
        </h1>
        <p className="text-sm text-eq-grey mt-2 leading-relaxed">
          Use at least 10 characters. Mixing upper / lower case, numbers and
          symbols makes it stronger.
        </p>
      </div>
      <ResetPasswordForm />
      <p className="text-[11px] text-eq-grey leading-relaxed border-t border-gray-100 pt-4">
        Once you save, you&rsquo;ll be signed out everywhere and asked to sign
        in again with your new password.
      </p>
    </div>
  )
}
