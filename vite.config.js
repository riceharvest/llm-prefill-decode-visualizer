import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The ./api handlers are Vercel serverless functions in production. Mount them
// on the Vite middleware stack in dev so /api/* works with plain `npm run dev`.
import benchmarksApi from './api/benchmarks.js'
import bestApi from './api/best.js'
import computeApi from './api/compute.js'
import localmaxxingApi from './api/localmaxxing.js'
import presetsApi from './api/presets.js'
import specApi from './api/spec.js'

const apiRoutes = {
  '/api/benchmarks': benchmarksApi,
  '/api/best': bestApi,
  '/api/compute': computeApi,
  '/api/localmaxxing': localmaxxingApi,
  '/api/presets': presetsApi,
  '/api/spec': specApi,
}

function vercelApiDev() {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Mirror the vercel.json rewrite: /compare/:a-vs-:b -> /compare.html,
        // so the SEO pages work under plain `npm run dev` too.
        if (/^\/compare\/[^/]+-vs-[^/]+\/?$/.test(req.url?.split('?')[0] || '')) {
          req.url = '/compare.html'
        }
        const path = req.url?.split('?')[0]
        const handler = apiRoutes[path]
        if (!handler) return next()
        const url = new URL(req.url, 'http://localhost')
        req.query = Object.fromEntries(url.searchParams)
        Promise.resolve(handler(req, res)).catch(err => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: String(err?.message || err) }))
        })
      })
    },
  }
}

// https://vite.dev/config/
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), vercelApiDev()],
  build: {
    rollupOptions: {
      // Multi-page: main app (index.html) + SEO comparison page (compare.html).
      input: {
        main: resolve(dirname(fileURLToPath(import.meta.url)), 'index.html'),
        compare: resolve(dirname(fileURLToPath(import.meta.url)), 'compare.html'),
      },
    },
  },
  server: {
    proxy: {
      '/localmaxxing-api': {
        target: 'https://www.localmaxxing.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/localmaxxing-api/, '/api'),
      },
    },
  },
})
