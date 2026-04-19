/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */

const EQ_LOGO_URL = 'https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_blue_transparent.svg'

/**
 * Persistent "Powered by EQ" attribution — bottom-right sticky anchor.
 *
 * Visible on every screen regardless of tenant skin. Clicking navigates to
 * the EQ marketing site (eq.solutions). This element establishes product
 * ownership in the UI chrome and MUST NOT be removed, hidden, or recoloured
 * by tenant theming.
 *
 * Anchored high enough (bottom-14) to sit above the global footer so both
 * remain visible without overlap.
 */
export function EqAttribution() {
  return (
    <a
      href="https://eq.solutions"
      target="_blank"
      rel="noopener noreferrer"
      title="Powered by EQ"
      aria-label="Powered by EQ — visit eq.solutions"
      className="fixed bottom-14 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 text-[11px] text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-eq-deep"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={EQ_LOGO_URL} alt="" aria-hidden="true" className="h-4 w-auto" />
      <span className="font-medium">Powered by EQ</span>
    </a>
  )
}
