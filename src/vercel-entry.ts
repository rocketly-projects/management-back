import { handle } from 'hono/vercel'
import app from './index'

export const config = {
  runtime: 'nodejs',
}

export default handle(app)
