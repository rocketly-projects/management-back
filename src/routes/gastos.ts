import { Hono } from 'hono'
import { z } from 'zod'
import type { Gasto } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { zvQuery } from '../lib/validator.js'

type Variables = { tenantId: string; email: string }

// ── Schema ────────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  cajaId: z.string().optional(),
  desde:  z.string().datetime({ message: 'desde debe ser una fecha ISO 8601 válida' }).optional(),
  hasta:  z.string().datetime({ message: 'hasta debe ser una fecha ISO 8601 válida' }).optional(),
})

// ── Serialización ─────────────────────────────────────────────────────────────

function serializeGasto(g: Gasto & { caja?: { apertura: Date } }) {
  return {
    ...g,
    monto: g.monto.toNumber(),
    cajaApertura: g.caja?.apertura.toISOString() ?? null,
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const gastosRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /gastos
 * Lista de gastos del tenant con paginación y filtros (cross-caja).
 * Query: page, limit, cajaId, desde, hasta (filtran por creadoEn)
 */
gastosRoutes.get('/', zvQuery(listQuerySchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { page, limit, cajaId, desde, hasta } = c.req.valid('query')

  const where = {
    caja: { tenantId },
    ...(cajaId ? { cajaId } : {}),
    ...(desde || hasta
      ? {
          creadoEn: {
            ...(desde ? { gte: new Date(desde) } : {}),
            ...(hasta ? { lte: new Date(hasta) } : {}),
          },
        }
      : {}),
  }

  const [gastos, total, sumAgg] = await prisma.$transaction([
    prisma.gasto.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { caja: { select: { apertura: true } } },
    }),
    prisma.gasto.count({ where }),
    prisma.gasto.aggregate({ where, _sum: { monto: true } }),
  ])

  return c.json({
    data: gastos.map(serializeGasto),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    totals: {
      monto: sumAgg._sum.monto?.toNumber() ?? 0,
    },
  })
})

export default gastosRoutes
