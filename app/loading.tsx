/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */

/**
 * Root loading splash.
 *
 * Shown briefly before any route segment resolves — before the tenant
 * skin (e.g. SKS) takes over the app shell. This establishes product
 * identity (EQ) at the earliest possible paint, which is required per
 * the EQ-IP-Register item #12. Tenant skin never replaces this splash
 * because the splash paints before any tenant data is fetched.
 */
const EQ_LOGO_URL =
  'https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_blue_transparent.svg'

export default function RootLoading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={EQ_LOGO_URL} alt="EQ" className="h-12 w-auto" />
        <p className="text-sm text-gray-500">Loading EQ Solves Service…</p>
      </div>
      <p className="absolute bottom-6 text-[11px] text-gray-400">
        © 2026 EQ · CDC Solutions Pty Ltd · ABN 40 651 962 935
      </p>
    </div>
  )
}
