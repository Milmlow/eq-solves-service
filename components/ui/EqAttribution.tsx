/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */

const EQ_LOGO_URL = 'https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_blue_transparent.svg'

/**
 * Persistent "Powered by EQ" attribution — bottom-LEFT sticky anchor.
 *
 * Visible on every screen regardless of tenant skin. Clicking navigates to
 * the EQ marketing site (eq.solutions). This element establishes product
 * ownership in the UI chrome and MUST NOT be removed or hidden by tenant
 * theming — position/opacity may be adjusted so it doesn't collide with
 * the Cowork assistant or other floating UI.
 *
 * Moved to bottom-left 2026-04-21 because the bottom-right slot conflicts
 * with the Cowork assistant launcher. Softened (reduced opacity + smaller
 * logo) so it doesn't compete with primary actions but is still visible on
 * hover. Anchored at bottom-14 to sit above the global footer.
 */
export function EqAttribution() {
  return (
    <a
      href="https://eq.solutions"
      target="_blank"
      rel="noopener noreferrer"
      title="Powered by EQ"
      aria-label="Powered by EQ — visit eq.solutions"
      className="fixed bottom-14 left-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-gray-200/70 bg-white/60 px-2.5 py-1 text-[10px] text-gray-500 shadow-sm backdrop-blur opacity-60 transition-all hover:opacity-100 hover:bg-white hover:text-eq-deep"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={EQ_LOGO_URL} alt="" aria-hidden="true" className="h-3 w-auto" />
      <span className="font-medium">Powered by EQ</span>
    </a>
  )
}
