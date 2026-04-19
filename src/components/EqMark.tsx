/**
 * EQ logo mark.
 *
 * Canonical source: Cloudflare R2 (see EQ Design Brief v1.3).
 * Paths are inlined here so the PWA renders the mark when offline.
 * If the upstream SVG ever changes, resync from:
 *   https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_blue_transparent.svg
 *   https://pub-409bd651f2e549f4907f5a856a9264ae.r2.dev/EQ_logo_white_transparent.svg
 *
 * Rules (per v1.3):
 *  - Two variants only: blue (#3DA8D8) on light, white on dark.
 *  - Never recolour the mark.
 *  - Never add shadows, outlines, gradients.
 *  - Minimum 24px in digital contexts.
 *  - Clear space = logo height on all sides (caller responsibility).
 */
interface EqMarkProps {
  variant?: 'blue' | 'white'
  size?: number
  className?: string
  /**
   * 'full' = native 1024×1024 viewBox (includes the design-brief clear-space).
   * 'tight' = cropped to the actual glyph; use in chrome/nav lockups where the
   * component handles its own clear-space and you want the mark to read bold.
   */
  fit?: 'full' | 'tight'
  'aria-hidden'?: boolean
}

// Tight bounding box around the actual PATH_D_1 + PATH_D_2 + rotated rect
// content. Determined empirically — trims ~140px left, ~150px right, ~330px
// top, ~340px bottom of transparent clear-space.
const TIGHT_VIEW_BOX = '120 320 780 380'
const FULL_VIEW_BOX = '0 0 1024 1024'

const PATH_D_1 =
  'M721.22,622.17l46.95,47q-31,12.78-67,12.78-70.68,0-121.58-48.84a162,162,0,0,1-31.23-40.81c15.14-18.46,31.52-39,46-58.58q5.83,34.5,28.53,58.21,30.47,31.86,78.27,31.85A121.63,121.63,0,0,0,721.22,622.17Z'

const PATH_D_2 =
  'M874.32,508.74q0,36.54-12.29,67l-52.8-52.81c.45-4.58.65-9.33.65-14.2q0-51.27-30.45-83.1t-78.27-31.89c-41.88,0-71.72,22-93.95,55.63-23.45,35.54-44.66,72.83-73.39,104.55C493,599,439.3,647.71,390.38,667.77c-2.58,1.07-5.2,2.09-7.86,3-.53.21-1,.37-1.55.53-1.11.37-2.22.74-3.28,1.11-3.89,1.23-7.41,2.25-10.6,3.11-1.19.33-2.34.61-3.44.86-.82.2-1.6.41-2.37.57-6.47,1.52-10.36,2.09-11.1,2.17a.31.31,0,0,1-.12,0,217.44,217.44,0,0,1-34.71,2.71q-70.68,0-121.58-48.84T142.89,508.74q0-75.47,50.88-124.32t121.58-48.84q56.11,0,96.28,27.35t65.08,77.94L251.61,565.56l-25.05-48.72,164.39-91Q374.32,409.1,358,401.45t-42.65-7.7q-47.83,0-78.31,31.89t-30.5,83.1q0,51.27,30.5,83.14t78.31,31.85a213,213,0,0,0,43.18-6.35c66.73-17.07,122.15-91,160.31-144.09,20.46-28.45,35.28-64.47,60.7-88.87q50.91-48.81,121.58-48.84,71.3,0,122.23,48.84T874.32,508.74Z'

export function EqMark({
  variant = 'blue',
  size = 32,
  fit = 'full',
  className,
  ...rest
}: EqMarkProps) {
  const fill = variant === 'white' ? '#FFFFFF' : '#3DA8D8'
  const viewBox = fit === 'tight' ? TIGHT_VIEW_BOX : FULL_VIEW_BOX
  // When cropped, the glyph is ~2:1 (wider than tall). Render width to match
  // so the lockup beside it doesn't see extra horizontal whitespace.
  const width = fit === 'tight' ? Math.round(size * (780 / 380)) : size
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={width}
      height={size}
      className={className}
      role="img"
      aria-label={rest['aria-hidden'] ? undefined : 'EQ'}
      aria-hidden={rest['aria-hidden'] ? true : undefined}
    >
      <g>
        <path fill={fill} d={PATH_D_1} />
        <path fill={fill} d={PATH_D_2} />
        <rect
          fill={fill}
          x="745.11"
          y="474.28"
          width="66.9"
          height="223.16"
          transform="translate(-186.23 722.12) rotate(-45)"
        />
      </g>
    </svg>
  )
}

/**
 * "EQ" wordmark variant — just the mark plus "Asset Capture" product label.
 * Used in hero contexts (HomePage, PinGate) where we want to identify the app.
 */
export function EqLockup({
  variant = 'blue',
  productLabel = 'Asset Capture',
  size = 32,
}: {
  variant?: 'blue' | 'white'
  productLabel?: string
  size?: number
}) {
  return (
    <div className="inline-flex items-center gap-2.5">
      <EqMark variant={variant} size={size} aria-hidden />
      <span
        className={`font-semibold tracking-tight leading-none ${
          variant === 'white' ? 'text-white' : 'text-ink'
        }`}
        style={{ fontSize: Math.round(size * 0.5) }}
      >
        {productLabel}
      </span>
    </div>
  )
}
