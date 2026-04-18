import { useEffect, useState } from 'react'

// Simple hash-based routing. Good enough for Phase 1.
// Routes:
//   #/                        → job picker (single-site URL model means usually redirects)
//   #/j/:jobId                → asset list for a job
//   #/j/:jobId/a/:assetId     → asset detail / capture form
//   #/j/:jobId/export         → export page

export type Route =
  | { name: 'home' }
  | { name: 'debug' }
  | { name: 'import' }
  | { name: 'job'; jobRef: string }
  | { name: 'asset'; jobRef: string; assetId: string }
  | { name: 'admin'; jobRef: string }
  | { name: 'export'; jobRef: string }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '').replace(/^\/+/, '')
  if (!h) return { name: 'home' }
  const parts = h.split('/').filter(Boolean)
  if (parts[0] === 'debug') return { name: 'debug' }
  if (parts[0] === 'import') return { name: 'import' }
  if (parts[0] === 'j' && parts[1]) {
    const jobRef = parts[1]
    if (parts[2] === 'a' && parts[3]) {
      return { name: 'asset', jobRef, assetId: parts[3] }
    }
    if (parts[2] === 'export') {
      return { name: 'export', jobRef }
    }
    if (parts[2] === 'admin') {
      return { name: 'admin', jobRef }
    }
    return { name: 'job', jobRef }
  }
  return { name: 'home' }
}

export function navigate(path: string) {
  window.location.hash = path
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return route
}
