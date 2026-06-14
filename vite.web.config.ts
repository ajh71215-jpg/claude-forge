/**
 * Browser-only Vite config for DESIGN PREVIEW of the renderer.
 *
 *   npm run dev:web      → http://localhost:5199/  (auto-opens)
 *
 * This runs the React UI in a normal browser with full HMR — NO Electron, NO
 * Claude SDK. The preload bridge (`window.forge`) is replaced by a mock
 * (dev-preview/forge-mock.ts) injected into the page before the app boots, so
 * the auth gate is passed and every tab (CHAT / SQUAD / EXTEND) renders with
 * sample data. Use it to iterate on layout, theme, spacing, components, etc.
 *
 * The real app still runs via `npm run dev` (electron-vite). This config and
 * the dev-preview/ folder live outside src/ and never affect the prod build.
 */
import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const RENDERER_HTML = '/src/renderer/index.html'

/** Reuse the real renderer index.html but, for the browser, (1) drop the strict
 *  CSP meta (it blocks Vite's React Fast Refresh inline script) and (2) inject
 *  the window.forge mock so it runs before main.tsx. */
function browserPreviewPlugin(): Plugin {
  return {
    name: 'forge-browser-preview',
    transformIndexHtml(html) {
      return (
        html
          // 1. drop the strict CSP (blocks Vite's React Fast Refresh inline script)
          .replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i, '')
          // 2. absolutize the entry so it resolves even when the page is served at "/"
          //    (a relative "./src/main.tsx" would otherwise 404 against the "/" URL).
          //    Match the PATH only — Vite appends a "?t=<ts>" HMR query after edits,
          //    so anchoring on the closing quote would miss it and leak the relative path.
          .replace(/\.\/src\/main\.tsx/, '/src/renderer/src/main.tsx')
          // 3. inject the window.forge mock so it runs before the app boots
          .replace(
            '<div id="root"></div>',
            '<div id="root"></div>\n    <script type="module" src="/dev-preview/forge-mock.ts"></script>'
          )
      )
    },
    configureServer(server) {
      // Land on the renderer page when visiting "/".
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html') req.url = RENDERER_HTML
        next()
      })
    }
  }
}

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react(), browserPreviewPlugin()],
  server: {
    port: 5199,
    open: RENDERER_HTML,
    fs: { allow: [resolve(__dirname)] }
  }
})
