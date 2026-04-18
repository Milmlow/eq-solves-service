// EQ Asset Capture — Service worker
// Strategy: network-first for the app shell (so field techs always get updates
// when online), with a cache fallback so they can launch the app in a data hall
// that has no signal. Data is handled by the app's own localStorage queue —
// we do NOT cache API responses here.

const VERSION = 'eq-asset-capture-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Never cache Supabase API traffic
  if (url.hostname.endsWith('.supabase.co')) return

  // Never cache runtime config — always fetch fresh so key rotations take effect
  if (url.pathname === '/config.js') return

  // Same-origin: network-first, cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match('/index.html'))),
    )
    return
  }

  // Cross-origin (fonts, etc.): cache-first
  event.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req)),
  )
})
