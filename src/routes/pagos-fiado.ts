import { Hono } from 'hono'
import { z } from 'zod'
import type { PagoFiado } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { zv, zvQuery } from '../lib/validator.js'

type Variables = { tenantId: string; email: string }

class BusinessError extends Error {
  constructor(public readonly status: 400 | 404 | 409 | 422, message: string) {
    super(message)
    this.name = 'BusinessError'
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const pagoSchema = z.object({
  clienteId:  z.string().min(1, 'clienteId es requerido'),
  monto:      z.number().positive('El monto debe ser mayor a 0'),
  metodoPago: z.enum(
    ['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'MERCADO_PAGO'],
    { required_error: 'El método de pago es requerido' },
  ),
  ventaId:    z.string().optional(),
  notas:      z.string().optional(),
})

const querySchema = z.object({
  clienteId: z.string().optional(),
})

// ── Serialización ─────────────────────────────────────────────────────────────

function serialize(p: PagoFiado) {
  return { ...p, monto: p.monto.toNumber() }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const pagosFiadoRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /pagos-fiado?clienteId=
 */
pagosFiadoRoutes.get('/', zvQuery(querySchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { clienteId } = c.req.valid('query')

  const pagos = await prisma.pagoFiado.findMany({
    where: { tenantId, ...(clienteId ? { clienteId } : {}) },
    orderBy: { creadoEn: 'desc' },
  })

  return c.json(pagos.map(serialize))
})

/**
 * POST /pagos-fiado
 * Registra un pago de fiado.
 *  - monto > 0
 *  - metodoPago !== FIADO
 *  - cliente debe pertenecer al tenant
 *  - si viene ventaId, la venta debe pertenecer al tenant y al cliente
 */
pagosFiadoRoutes.post('/', zv(pagoSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { clienteId, monto, metodoPago, ventaId, notas } = c.req.valid('json')

  try {
    const pago = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({
        where: { id: clienteId, tenantId, activo: true },
      })
      if (!cliente) throw new BusinessError(404, 'Cliente no encontrado')

      if (ventaId) {
        const venta = await tx.venta.findFirst({
          where: { id: ventaId, tenantId, clienteId },
        })
        if (!venta) {
          throw new BusinessError(404, 'Venta no encontrada o no pertenece al cliente')
        }
      }

      return tx.pagoFiado.create({
        data: {
          tenantId,
          clienteId,
          ventaId: ventaId ?? null,
          monto,
          metodoPago,
          notas,
        },
      })
    })

    return c.json(serialize(pago), 201)
  } catch (err) {
    if (err instanceof BusinessError) {
      return c.json({ error: err.message }, err.status)
    }
    throw err
  }
})

export default pagosFiadoRoutes
