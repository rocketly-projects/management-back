import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

function validationHook<T extends z.ZodTypeAny>(
  result: { success: boolean; error?: z.ZodError<z.infer<T>> },
  c: Parameters<Parameters<typeof zValidator>[2] & object>[1],
) {
  if (!result.success && result.error) {
    return c.json(
      {
        error: 'Validation error',
        details: result.error.flatten().fieldErrors,
      },
      422 as const,
    )
  }
}

/**
 * Valida el body JSON y retorna 422 con detalle de campos si falla.
 * Usar en todos los endpoints en lugar de zValidator directo.
 */
export function zv<T extends z.ZodTypeAny>(schema: T) {
  return zValidator('json', schema, validationHook)
}

/**
 * Valida query params y retorna 422 con detalle de campos si falla.
 */
export function zvQuery<T extends z.ZodTypeAny>(schema: T) {
  return zValidator('query', schema, validationHook)
}
