import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Phase 1 of the Testing simplification (2026-04-28). The legacy
      // top-level routes /acb-testing and /nsx-testing now point at the
      // canonical /testing/* tabs. permanent: true → 308 (modern 301 that
      // preserves the HTTP method and is treated as permanent by browsers
      // and search indexers).
      { source: '/acb-testing', destination: '/testing/acb', permanent: true },
      { source: '/acb-testing/:path*', destination: '/testing/acb/:path*', permanent: true },
      { source: '/nsx-testing', destination: '/testing/nsx', permanent: true },
      { source: '/nsx-testing/:path*', destination: '/testing/nsx/:path*', permanent: true },
    ]
  },
};

export default nextConfig;
