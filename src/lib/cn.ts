// Tiny className joiner. Drops falsy, joins with space.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
