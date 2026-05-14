import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pin the workspace root to the directory containing this config file.
// Without this, Next.js warns about multiple lockfiles when this project is
// running from a Cowork agent worktree (which has its own package-lock.json
// alongside the main repo's) and falls back to the main repo as the root.
// Runtime behaviour appears unaffected, but the warning clutters CI logs
// and the resolved root is wrong, which can subtly break monorepo-style
// builds. Setting both `outputFileTracingRoot` (build-time tracing) and
// `turbopack.root` (dev-mode resolver) silences the warning and pins the
// root to where this file actually lives.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
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
      // Commercial tools (renewal pack + contract-scope import/derive) moved
      // out of the Admin block into a dedicated /commercials hub. 308 keeps
      // bookmarks and any external deep links working.
      { source: '/admin/renewal-pack', destination: '/commercials/renewal-pack', permanent: true },
      { source: '/admin/renewal-pack/:path*', destination: '/commercials/renewal-pack/:path*', permanent: true },
      { source: '/admin/contract-scopes/import', destination: '/commercials/contract-scopes/import', permanent: true },
      { source: '/admin/contract-scopes/import/:path*', destination: '/commercials/contract-scopes/import/:path*', permanent: true },
      { source: '/admin/contract-scopes/derive', destination: '/commercials/contract-scopes/derive', permanent: true },
      { source: '/admin/contract-scopes/derive/:path*', destination: '/commercials/contract-scopes/derive/:path*', permanent: true },
    ]
  },
};

export default nextConfig;
