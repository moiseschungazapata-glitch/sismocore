import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { BackendSupervisor } from '../../scripts/backend.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const localBackend = ['http://127.0.0.1:8000', 'http://localhost:8000'].includes(target)
  const backend = new BackendSupervisor()
  return {
    plugins: [react(), {
      name: 'sismocore-push-worker',
      configureServer(server) {
        server.middlewares.use('/firebase-messaging-sw.js', async (_request,response) => {
          try {
            const result = await server.transformRequest('/src/firebase-messaging-sw.ts')
            if (!result) { response.statusCode = 503; response.end(); return }
            response.setHeader('Content-Type','text/javascript')
            response.setHeader('Cache-Control','no-cache')
            response.setHeader('Service-Worker-Allowed','/')
            response.end(result.code)
          } catch { response.statusCode = 503; response.end() }
        })
      },
    }, {
      name: 'sismocore-backend',
      apply: 'serve',
      async configureServer(server) {
        if (!localBackend) return
        await backend.start()
        server.httpServer?.once('close', () => backend.stop())
        server.middlewares.use((request, response, next) => {
          const path = (request.url || '').split('?')[0]
          if (path !== '/health' && path !== '/api' && !path.startsWith('/api/')) return next()
          void backend.ensure().then(ready => {
            if (response.destroyed) return
            if (ready) return next()
            response.statusCode = 503
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ detail: backend.lastError || 'La API se está iniciando. Reintenta en unos segundos.' }))
          }).catch(() => {
            if (response.destroyed) return
            response.statusCode = 503
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ detail: 'No se pudo recuperar el servicio local. Revisa la ventana de inicio.' }))
          })
        })
      },
      closeBundle() { backend.stop() },
    }],
    server: {
      host: '127.0.0.1', port: 5173, strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/health': { target, changeOrigin: true },
      },
    },
  }
})
