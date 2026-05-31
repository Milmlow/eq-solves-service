/**
 * Thin re-export — canonical implementation lives in @eq-solutions/ui.
 *
 * All call sites import from '@/components/ui/FormInput' so nothing needs to
 * change at the call sites. The kit FormInput is API-compatible: same label,
 * error, hint, and className props plus forwardRef and auto-generated IDs
 * wired to aria-describedby for improved accessibility.
 *
 * Diff from the local version:
 * - Label uses eq-field__label CSS class (from @eq-solutions/tokens) rather
 *   than Tailwind classes. Visually: same weight/size, token-driven colour.
 * - Input uses eq-field__input / eq-field__input--error classes rather than
 *   Tailwind classes. Focus ring / error ring driven by CSS custom properties.
 * - Auto-generates an id via useId() and wires htmlFor + aria-describedby so
 *   screen readers announce hint / error text.
 */
export { FormInput } from '@eq-solutions/ui'
export type { FormInputProps } from '@eq-solutions/ui'
