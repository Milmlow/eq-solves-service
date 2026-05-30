/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui.
 *
 * All call sites import from '@/components/ui/Button' so nothing needs to
 * change at the call sites. The canonical Button is API-compatible: same
 * variant (primary / secondary / danger) and size (sm / md / lg) props,
 * plus an additive ghost variant for Shell contexts.
 */
export { Button } from '@eq-solutions/ui'
export type { ButtonProps, ButtonVariant, ButtonSize } from '@eq-solutions/ui'
