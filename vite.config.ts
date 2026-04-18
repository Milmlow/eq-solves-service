import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Pin build timestamp so the footer shows which deploy a tech is on — helpful
// for bug reports. Regenerated on every `vite build`.
const BUILD_TIME = new Date().toISOString().slice(0, 16).replace('T', ' ')
const SW_VERSION = `eq-asset-capture-${BUILD_TIME.replace(/[^\d]/g, '')}`

// Rewrites the `VERSION` constant in the built sw.js at close-bundle time so
// each deploy invalidates the prior service-worker cache. sw.js lives in
// public/ which bypasses the Rollup bundle graph, so we rewrite the copied
// file in dist/.
function swVersionPlugin(): Plugin {
  return {
    name: 'eq-sw-version',
    apply: 'build',
    closeBundle() {
      const target = join(__dirname, 'dist', 'sw.js')
      if (!existsSync(target)) return
      const src = readFileSync(target, 'utf8')
      const rewritten = src.replace(
        /const VERSION\s*=\s*'[^']+'/,
        `const VERSION = '${SW_VERSION}'`,
      )
      writeFileSync(target, rewritten, 'utf8')
    },
  }
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(BUILD_TIME),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
