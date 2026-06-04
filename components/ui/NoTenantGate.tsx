import { requestAccessAction, cancelAccessRequestAction } from '@/lib/actions/access-request'

export interface PendingAccessRequest {
  created_at: string
  note: string | null
}

/**
 * Shown to an authenticated user with no tenant_members row, in place of the
 * old dead-end "No tenant assigned" screen. Lets them record a pending access
 * request (not a membership) so they aren't stuck — an admin actions it via the
 * /admin/users orphan-attach flow. Server-rendered with form actions; no client
 * JS needed.
 */
export function NoTenantGate({
  email,
  pending,
}: {
  email: string | null
  pending: PendingAccessRequest | null
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>

        {pending ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">Access requested</h1>
            <p className="text-sm text-gray-500 mb-1">
              We&apos;ve recorded your request for{' '}
              <span className="font-medium text-gray-700">{email}</span>. An administrator
              will review it and add you to your organisation.
            </p>
            <p className="text-xs text-gray-400 mb-6">
              Requested {new Date(pending.created_at).toLocaleString('en-AU')}
            </p>
            <div className="flex items-center justify-center gap-3">
              <form action={cancelAccessRequestAction}>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel request
                </button>
              </form>
              <a
                href="/auth/signout"
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-eq-deep rounded-lg hover:bg-eq-sky transition-colors"
              >
                Sign out
              </a>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-gray-900 mb-2">No tenant assigned</h1>
            <p className="text-sm text-gray-500 mb-4">
              Your account <span className="font-medium text-gray-700">{email}</span> isn&apos;t
              part of an organisation yet. Request access and an administrator will add you.
            </p>
            <form action={requestAccessAction} className="text-left">
              <label htmlFor="note" className="block text-xs font-medium text-gray-600 mb-1">
                Note (optional)
              </label>
              <textarea
                id="note"
                name="note"
                rows={2}
                maxLength={500}
                placeholder="e.g. which organisation you belong to"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-eq-sky/40 resize-none"
              />
              <div className="flex items-center justify-center gap-3 mt-4">
                <a
                  href="/auth/signout"
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Sign out
                </a>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-eq-deep rounded-lg hover:bg-eq-sky transition-colors"
                >
                  Request access
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
