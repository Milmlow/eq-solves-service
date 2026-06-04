/**
 * Cookie security options for the Shell↔Service seam.
 *
 * Service is embedded as an iframe inside Shell. The SameSite policy the
 * session + bridge cookies need depends on whether Service is served
 * SAME-SITE with Shell:
 *
 *   • Deployed at <app>.eq.solutions (a sibling of core.eq.solutions) → the
 *     iframe is SAME-SITE (registrable domain eq.solutions). SameSite=Lax
 *     cookies are sent and are NOT subject to browser third-party-cookie
 *     blocking. This is the Cards (cards.eq.solutions) / Field pattern and
 *     the only configuration that reliably avoids the "double login".
 *
 *   • Deployed at *.netlify.app (cross-site with Shell) → the iframe is a
 *     third-party context. Cookies must be SameSite=None;Secure to be sent
 *     at all — and even then Safari ITP / Chrome's third-party-cookie
 *     phase-out block them, which is the root cause of the double login.
 *     Kept only as a fallback for the cutover window while both origins
 *     serve in parallel.
 *
 * Host-based on purpose: the correct policy applies automatically the moment
 * DNS points service.eq.solutions at this deploy — no env flag to flip, and
 * both origins behave correctly while they serve side by side. Mirrors how
 * Cards/Field rely on being served under *.eq.solutions rather than a build
 * flag.
 */

/** True when `host` is eq.solutions or any subdomain of it (port-tolerant). */
export function isEqSolutionsHost(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.split(':')[0].toLowerCase()
  return h === 'eq.solutions' || h.endsWith('.eq.solutions')
}

/** Cookie options block in dev — empty so browser defaults apply on localhost. */
export type ShellCookieOptions =
  | Record<string, never>
  | { sameSite: 'lax' | 'none'; secure: true }

/**
 * SameSite/Secure options to spread onto every Shell-seam cookie
 * (Supabase session cookies + the `eq_shell_bridge` flag).
 *
 * @param host the request host (server) or window.location.hostname (browser)
 */
export function shellCookieOptions(host: string | null | undefined): ShellCookieOptions {
  // Dev (http://localhost) — no Secure, browser defaults are fine.
  if (process.env.NODE_ENV !== 'production') return {}
  return isEqSolutionsHost(host)
    ? { sameSite: 'lax', secure: true }
    : { sameSite: 'none', secure: true }
}
