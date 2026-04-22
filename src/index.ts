import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

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
