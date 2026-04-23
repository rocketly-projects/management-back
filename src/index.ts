import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth'
import productosRoutes from './routes/productos'
import cajaRoutes from './routes/caja'
import { authMiddleware } from './middleware/auth'

type Variables = {
  tenantId: string
  email: string
}

const app = new Hono<{ Variables: Variables }>()

app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
)

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
)

// ── Rutas públicas ────────────────────────────────────────────────────────────
app.route('/auth', authRoutes)

// ── Rutas protegidas ──────────────────────────────────────────────────────────
// Un único sub-router con authMiddleware aplicado a todo el grupo.
// Cada tanda nueva solo agrega una línea api.route(...) aquí.
const api = new Hono<{ Variables: Variables }>()
api.use('*', authMiddleware)
api.route('/productos', productosRoutes)
api.route('/caja',     cajaRoutes)
// api.route('/ventas',        ventasRoutes)         — Tanda 6
// api.route('/perfil',        perfilRoutes)         — Tanda 7
// api.route('/configuracion', configuracionRoutes)  — Tanda 7

app.route('/', api)

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  const isProduction = process.env.NODE_ENV === 'production'
  const details = isProduction ? undefined : err.message

  const code = (err as { code?: unknown }).code
  if (code === 'P2002') {
    return c.json({ error: 'Conflict', details }, 409)
  }
  if (code === 'P2025') {
    return c.json({ error: 'Not Found', details }, 404)
  }

  if (!isProduction) {
    console.error(err)
  }
  return c.json({ error: 'Internal Server Error', details }, 500)
})

if (process.env.NODE_ENV !== 'production') {
  const port = Number(process.env.PORT) || 3000
  serve({ fetch: app.fetch, port })
  console.log(`Server running on http://localhost:${port}`)
}

export default app
