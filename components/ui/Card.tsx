/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui.
 *
 * All call sites import from '@/components/ui/Card' so nothing needs to
 * change at the call sites. The canonical Card uses Direction D tokens
 * (CSS custom props from @eq-solutions/tokens) and supports title/actions
 * header slots and typed padding tiers (none | sm | md | lg).
 *
 * Migration note for existing className padding overrides:
 *   p-0 / overflow-hidden p-0  → padding="none"  (overflow-hidden is the default)
 *   p-3                        → padding="sm"
 *   p-4 / (default)            → padding="md"    (default, omit prop)
 *   p-6                        → padding="lg"
 *   p-8                        → padding="lg"    (nearest tier)
 */
export { Card } from '@eq-solutions/ui'
export type { CardProps } from '@eq-solutions/ui'
