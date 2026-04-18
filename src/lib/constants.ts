/** localStorage keys used across the app. */
export const CAPTURED_BY_KEY = 'eq-captured-by'

/** Roster of SKS field capturers — alphabetised by first name. */
export const CAPTURER_ROSTER = [
  'Brian Griffin Colls',
  'Huon Henne',
  'John Anganan',
  'Luke Wheeler',
  'Matt Miller',
  'Nabeel Hussain',
  'Phillip Krikellis',
  'Richard Brown',
  'Simon Bramall',
  'William Brown',
].sort()

/**
 * Clear the capturer name and all per-job PIN passes, then broadcast an
 * in-app 'eq:signout' event so any mounted AssetPage re-prompts immediately.
 * Returns after clearing so the caller can navigate.
 */
export function signOut() {
  localStorage.removeItem(CAPTURED_BY_KEY)
  Object.keys(localStorage)
    .filter((k) => k.startsWith('eq-pin-pass'))
    .forEach((k) => localStorage.removeItem(k))
  window.dispatchEvent(new Event('eq:signout'))
}
