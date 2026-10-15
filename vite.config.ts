import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function mockApiPlugin(): Plugin {
  return {
    name: 'gemclip-mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next()
        }

        res.setHeader('Content-Type', 'application/json')

        if (req.url.startsWith('/api/credits')) {
          res.end(
            JSON.stringify({
              plan: 'free',
              daily_allowance: 10,
              spent_today: 0,
              remaining: 10,
              resets_at: new Date(Date.now() + 86400000).toISOString(),
            }),
          )
          return
        }

        if (req.url.startsWith('/api/history')) {
          res.end(JSON.stringify([]))
          return
        }

        if (req.url.startsWith('/api/paypal/config')) {
          res.end(
            JSON.stringify({
              client_id: 'sb',
              plan_id: 'P-SAMPLE',
              price: '4.99',
              currency: 'EUR',
            }),
          )
          return
        }

        res.end(JSON.stringify({ status: 'ok' }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
