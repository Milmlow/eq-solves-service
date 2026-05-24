import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  // In a project using the `dom` lib, TypeScript maps `self` to Window.
  // Augmenting Window lets us reference self.__SW_MANIFEST without errors;
  // at runtime this property is injected by @serwist/next into the SW bundle.
  interface Window extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // When a navigation request fails offline, serve the cached offline page.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
  runtimeCaching: [
    // Cache maintenance check detail pages with network-first so techs can
    // open a recently-visited check in a switchroom with no signal.
    {
      matcher: ({ url }) => /^\/maintenance\/[0-9a-f-]{36}/.test(url.pathname),
      handler: new NetworkFirst({
        cacheName: "maintenance-checks",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
