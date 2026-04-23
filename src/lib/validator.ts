import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

/**
 * Wrapper de zValidator que fuerza 422 con detalle de campos
 * en lugar del 400 por defecto de @hono/zod-validator.
 * Usar en todos los endpoints en lugar de zValidator directo.
 */
export function zv<T extends z.ZodTypeAny>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: 'Validation error',
          details: result.error.flatten().fieldErrors,
        },
        422,
      )
    }
  })
}
