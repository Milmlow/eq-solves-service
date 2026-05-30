/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui.
 *
 * All call sites import from '@/components/ui/Skeleton' so nothing needs to
 * change at the call sites. API is compatible: same Skeleton / SkeletonRows /
 * SkeletonCards names + same core props (shape, count, columns).
 *
 * Diff from the local version:
 * - Skeleton renders a <span> (canonical) vs <div> (local). Visually identical
 *   for block-level loading placeholders; both are display:block by default
 *   via the eq-skeleton CSS class.
 * - The 'custom' shape alias is dropped — callers should use width/height props
 *   instead. No existing call site in this repo used shape="custom".
 * - Animations are driven by CSS custom properties (--eq-duration-default)
 *   instead of Tailwind's animate-pulse, so the timing is identical to the
 *   EQ Shell skeleton and any future shared surfaces.
 */
export { Skeleton, SkeletonRows, SkeletonCards } from '@eq-solutions/ui'
export type {
  SkeletonProps,
  SkeletonShape,
  SkeletonRowsProps,
  SkeletonCardsProps,
} from '@eq-solutions/ui'
