import { createMiddleware } from 'hono/factory'
import { verifyJwt } from '../lib/jwt'

type AuthVariables = {
  tenantId: string
  email: string
}

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice(7).trim()
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
      const payload = await verifyJwt(token)
      c.set('tenantId', payload.tenantId)
      c.set('email', payload.email)
    } catch {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    await next()
  },
)
