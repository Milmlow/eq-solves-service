// Bump the patch on every deploy so field techs can report exact version
// in bug reports. The BUILD_TIME is set at build time by Vite from define.
export const APP_VERSION = '0.3.0'
export const BUILD_TIME: string = (import.meta.env.VITE_BUILD_TIME as string) ?? 'dev'

export function versionLabel(): string {
  if (BUILD_TIME === 'dev') return `v${APP_VERSION}`
  // Short ISO timestamp: 2026-04-17 20:40
  return `v${APP_VERSION} · ${BUILD_TIME}`
}
