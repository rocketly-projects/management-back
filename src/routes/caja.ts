import { Hono } from 'hono'
import { z } from 'zod'
import type { Caja, Gasto } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { zv, zvQuery } from '../lib/validator.js'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const abrirSchema = z.object({
  montoInicial: z
    .number({ required_error: 'El monto inicial es requerido' })
    .min(0, 'El monto inicial no puede ser negativo'),
})

const cerrarSchema = z.object({
  montoCierre: z
    .number({ required_error: 'El monto de cierre es requerido' })
    .min(0, 'El monto de cierre no puede ser negativo'),
  notas: z.string().optional(),
})

const gastoSchema = z.object({
  descripcion: z.string().min(1, 'La descripción es requerida'),
  monto: z.number({ required_error: 'El monto es requerido' })
           .positive('El monto debe ser mayor a 0'),
})

const listQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  estado: z.enum(['ABIERTA', 'CERRADA']).optional(),
  desde:  z.string().datetime({ message: 'desde debe ser una fecha ISO 8601 válida' }).optional(),
  hasta:  z.string().datetime({ message: 'hasta debe ser una fecha ISO 8601 válida' }).optional(),
})

// ── Serialización (Decimal → number) ─────────────────────────────────────────

function serializeCaja(c: Caja) {
  return {
    ...c,
    montoInicial: c.montoInicial.toNumber(),
    montoCierre:  c.montoCierre?.toNumber() ?? null,
  }
}

function serializeGasto(g: Gasto) {
  return { ...g, monto: g.monto.toNumber() }
}

// ── Routes ────────────────────────────────────────────────────────────────────
// IMPORTANTE: las rutas literales (/activa, /abrir, /cerrar) se definen
// ANTES que las paramétricas (/:id/...) para que Hono las resuelva correctamente.

const cajaRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /caja
 * Lista cajas del tenant con paginación + agregados (totalFacturado, cantVentas, gastosTotal).
 * Query: page, limit, estado, desde, hasta (filtran por apertura)
 */
cajaRoutes.get('/', zvQuery(listQuerySchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { page, limit, estado, desde, hasta } = c.req.valid('query')

  const where = {
    tenantId,
    ...(estado ? { estado } : {}),
    ...(desde || hasta
      ? {
          apertura: {
            ...(desde ? { gte: new Date(desde) } : {}),
            ...(hasta ? { lte: new Date(hasta) } : {}),
          },
        }
      : {}),
  }

  const [cajas, total] = await prisma.$transaction([
    prisma.caja.findMany({
      where,
      orderBy: { apertura: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.caja.count({ where }),
  ])

  // Agregados por caja: total facturado (COMPLETADA), cantVentas, gastosTotal
  const cajaIds = cajas.map((c) => c.id)
  const [ventasAgg, gastosAgg] = await Promise.all([
    cajaIds.length === 0
      ? Promise.resolve([] as Array<{ cajaId: string; _sum: { total: { toNumber: () => number } | null }; _count: { _all: number } }>)
      : prisma.venta.groupBy({
          by:    ['cajaId'],
          where: { cajaId: { in: cajaIds }, estado: 'COMPLETADA' },
          _sum:  { total: true },
          _count: { _all: true },
        }),
    cajaIds.length === 0
      ? Promise.resolve([] as Array<{ cajaId: string; _sum: { monto: { toNumber: () => number } | null } }>)
      : prisma.gasto.groupBy({
          by:    ['cajaId'],
          where: { cajaId: { in: cajaIds } },
          _sum:  { monto: true },
        }),
  ])

  const ventasByCaja = new Map(
    ventasAgg.map((v) => [v.cajaId, { total: v._sum.total?.toNumber() ?? 0, count: v._count._all }]),
  )
  const gastosByCaja = new Map(
    gastosAgg.map((g) => [g.cajaId, g._sum.monto?.toNumber() ?? 0]),
  )

  return c.json({
    data: cajas.map((c) => {
      const v = ventasByCaja.get(c.id) ?? { total: 0, count: 0 }
      const gastosTotal = gastosByCaja.get(c.id) ?? 0
      return {
        ...serializeCaja(c),
        totalFacturado: v.total,
        cantVentas:     v.count,
        gastosTotal,
      }
    }),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  })
})

/**
 * GET /caja/activa
 * Retorna la caja abierta del tenant, o null si no hay ninguna.
 */
cajaRoutes.get('/activa', async (c) => {
  const tenantId = c.get('tenantId')

  const caja = await prisma.caja.findFirst({
    where: { tenantId, estado: 'ABIERTA' },
  })

  return c.json(caja ? serializeCaja(caja) : null)
})

/**
 * POST /caja/abrir
 * Abre una nueva caja con montoInicial.
 * 400 si ya hay una caja abierta.
 */
cajaRoutes.post('/abrir', zv(abrirSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { montoInicial } = c.req.valid('json')

  const cajaAbierta = await prisma.caja.findFirst({
    where: { tenantId, estado: 'ABIERTA' },
  })
  if (cajaAbierta) {
    return c.json({ error: 'Ya hay una caja abierta', cajaId: cajaAbierta.id }, 400)
  }

  const caja = await prisma.caja.create({
    data: { tenantId, montoInicial },
  })

  return c.json(serializeCaja(caja), 201)
})

/**
 * POST /caja/cerrar
 * Cierra la caja activa registrando montoCierre, notas y fecha exacta.
 * 400 si no hay caja abierta.
 */
cajaRoutes.post('/cerrar', zv(cerrarSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { montoCierre, notas } = c.req.valid('json')

  const cajaAbierta = await prisma.caja.findFirst({
    where: { tenantId, estado: 'ABIERTA' },
  })
  if (!cajaAbierta) {
    return c.json({ error: 'No hay una caja abierta' }, 400)
  }

  const cajaCerrada = await prisma.caja.update({
    where: { id: cajaAbierta.id },
    data: {
      estado:      'CERRADA',
      cierre:      new Date(),
      montoCierre,
      notas:       notas ?? null,
    },
  })

  return c.json(serializeCaja(cajaCerrada))
})

/**
 * GET /caja/:id/resumen
 * Devuelve la caja con agregados completos: totales por método, gastos, etc.
 * Útil para mostrar el detalle de una caja en el historial.
 */
cajaRoutes.get('/:id/resumen', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const caja = await prisma.caja.findFirst({ where: { id, tenantId } })
  if (!caja) return c.json({ error: 'Caja no encontrada' }, 404)

  const [ventas, gastos, porMetodo] = await Promise.all([
    prisma.venta.findMany({
      where: { cajaId: id, estado: 'COMPLETADA' },
      select: { total: true, descuento: true },
    }),
    prisma.gasto.findMany({
      where: { cajaId: id },
      orderBy: { creadoEn: 'asc' },
    }),
    prisma.venta.groupBy({
      by:     ['metodoPago'],
      where:  { cajaId: id, estado: 'COMPLETADA' },
      _sum:   { total: true },
      _count: { _all: true },
    }),
  ])

  const totalFacturado = ventas.reduce((s, v) => s + v.total.toNumber(), 0)
  const cantVentas     = ventas.length
  const gastosTotal    = gastos.reduce((s, g) => s + g.monto.toNumber(), 0)

  return c.json({
    caja: serializeCaja(caja),
    totales: {
      totalFacturado,
      cantVentas,
      ticketPromedio: cantVentas > 0 ? totalFacturado / cantVentas : 0,
    },
    porMetodo: porMetodo.map((m) => ({
      metodoPago: m.metodoPago,
      total:      m._sum.total?.toNumber() ?? 0,
      cantidad:   m._count._all,
      porcentaje: totalFacturado > 0
        ? Math.round((((m._sum.total?.toNumber() ?? 0) / totalFacturado) * 100))
        : 0,
    })),
    gastos: {
      lista: gastos.map(serializeGasto),
      total: gastosTotal,
      cantidad: gastos.length,
    },
  })
})

/**
 * GET /caja/:id/gastos
 * Lista los gastos de una caja.
 * 404 si la caja no existe o no pertenece al tenant.
 */
cajaRoutes.get('/:id/gastos', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const caja = await prisma.caja.findFirst({ where: { id, tenantId } })
  if (!caja) return c.json({ error: 'Caja no encontrada' }, 404)

  const gastos = await prisma.gasto.findMany({
    where: { cajaId: id },
    orderBy: { creadoEn: 'asc' },
  })

  return c.json(gastos.map(serializeGasto))
})

/**
 * POST /caja/:id/gastos
 * Registra un gasto. La caja debe estar abierta.
 * 404 si la caja no pertenece al tenant.
 * 400 si la caja está cerrada.
 */
cajaRoutes.post('/:id/gastos', zv(gastoSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()
  const { descripcion, monto } = c.req.valid('json')

  const caja = await prisma.caja.findFirst({ where: { id, tenantId } })
  if (!caja) return c.json({ error: 'Caja no encontrada' }, 404)
  if (caja.estado !== 'ABIERTA') {
    return c.json({ error: 'No se pueden registrar gastos en una caja cerrada' }, 400)
  }

  const gasto = await prisma.gasto.create({
    data: { cajaId: id, descripcion, monto },
  })

  return c.json(serializeGasto(gasto), 201)
})

export default cajaRoutes
