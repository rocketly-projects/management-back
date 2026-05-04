import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { zvQuery } from '../lib/validator.js'
import { parseFechaUTC, getRangoDia, getRangoAyer, getUltimos7Dias } from '../lib/date-ranges.js'

type Variables = { tenantId: string; email: string }

// ── Constantes ────────────────────────────────────────────────────────────────

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/
const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

// ── Schemas ───────────────────────────────────────────────────────────────────

const fechaParam = z.string().regex(FECHA_REGEX, 'Debe estar en formato YYYY-MM-DD')

const dashboardSchema = z.object({
  fecha: fechaParam.optional(),
})

const comparativoSchema = z.object({
  fechaFin: fechaParam.optional(),
})

const ventasAgregadasSchema = z
  .object({
    desde:   fechaParam,
    hasta:   fechaParam,
    agrupar: z.enum(['hora', 'dia', 'metodo']),
    estado:  z.enum(['COMPLETADA', 'ANULADA', 'PENDIENTE']).default('COMPLETADA'),
  })
  .refine(
    (d) => parseFechaUTC(d.desde) <= parseFechaUTC(d.hasta),
    { message: 'desde debe ser anterior o igual a hasta', path: ['desde'] },
  )
  .refine(
    (d) =>
      parseFechaUTC(d.hasta).getTime() - parseFechaUTC(d.desde).getTime() <=
      366 * 86_400_000,
    { message: 'El rango no puede superar 366 días', path: ['hasta'] },
  )

// ── Helpers internos ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Calcula el delta porcentual entre actual y anterior.
 * Retorna null si no hubo ventas ayer (evita división por cero engañosa).
 */
function calcDelta(actual: number, anterior: number, hayAyer: boolean): number | null {
  if (!hayAyer) return null
  if (anterior === 0) return actual > 0 ? 100 : 0
  return Math.round(((actual - anterior) / anterior) * 1000) / 10 // 1 decimal
}

type RawDiaRow = { fecha: Date; total: number; cantidad: number }
type DiaSemana = (typeof DIAS_SEMANA)[number]

/**
 * Agrupa ventas por día en el rango dado y rellena los días sin ventas con 0.
 * Reutilizado por /comparativo-semanal y /cierre-caja/:cajaId.
 */
async function queryComparativoSemanal(
  tenantId: string,
  desde: Date,
  hasta: Date,
  estado: 'COMPLETADA' | 'ANULADA' | 'PENDIENTE' = 'COMPLETADA',
): Promise<Array<{ fecha: string; diaSemana: DiaSemana; total: number; cantidadVentas: number }>> {
  const rows = await prisma.$queryRaw<RawDiaRow[]>`
    SELECT
      DATE("creadoEn")   AS fecha,
      SUM(total)::float8 AS total,
      COUNT(*)::int      AS cantidad
    FROM "Venta"
    WHERE "tenantId" = ${tenantId}
      AND estado     = ${estado}::"EstadoVenta"
      AND "creadoEn" >= ${desde}
      AND "creadoEn" <= ${hasta}
    GROUP BY DATE("creadoEn")
    ORDER BY fecha ASC
  `

  const map = new Map(
    rows.map((r) => {
      const key =
        r.fecha instanceof Date
          ? r.fecha.toISOString().slice(0, 10)
          : String(r.fecha).slice(0, 10)
      return [key, r]
    }),
  )

  const dias: Array<{ fecha: string; diaSemana: DiaSemana; total: number; cantidadVentas: number }> = []
  const cursor = new Date(desde)
  while (cursor <= hasta) {
    const key = cursor.toISOString().slice(0, 10)
    const row = map.get(key)
    dias.push({
      fecha:          key,
      diaSemana:      DIAS_SEMANA[cursor.getUTCDay()],
      total:          row ? round2(row.total) : 0,
      cantidadVentas: row ? row.cantidad : 0,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dias
}

// ── Router ────────────────────────────────────────────────────────────────────

const reportesRoutes = new Hono<{ Variables: Variables }>()

// ── GET /reportes/dashboard ───────────────────────────────────────────────────

/**
 * KPIs del día: total facturado, cantidad de ventas, ticket promedio, productos
 * vendidos — cada uno con su delta vs ayer. También retorna desglose por hora
 * y top 5 productos.
 *
 * Query param: fecha (YYYY-MM-DD, default: hoy UTC)
 */
reportesRoutes.get('/dashboard', zvQuery(dashboardSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { fecha } = c.req.valid('query')

  const hoy = fecha ? parseFechaUTC(fecha) : new Date()
  const { desde: desdeDia, hasta: hastaDia }    = getRangoDia(hoy)
  const { desde: desdeAyer, hasta: hastaAyer }  = getRangoAyer(hoy)

  // Ronda 1: agregaciones y ventas del día (para agrupar por hora y obtener IDs)
  const [agregadosDia, agregadosAyer, ventasDelDia] = await Promise.all([
    prisma.venta.aggregate({
      where: { tenantId, estado: 'COMPLETADA', creadoEn: { gte: desdeDia, lte: hastaDia } },
      _sum:   { total: true },
      _count: { _all: true },
      _avg:   { total: true },
    }),
    prisma.venta.aggregate({
      where: { tenantId, estado: 'COMPLETADA', creadoEn: { gte: desdeAyer, lte: hastaAyer } },
      _sum:   { total: true },
      _count: { _all: true },
      _avg:   { total: true },
    }),
    prisma.venta.findMany({
      where:  { tenantId, estado: 'COMPLETADA', creadoEn: { gte: desdeDia, lte: hastaDia } },
      select: { id: true, creadoEn: true, total: true },
    }),
  ])

  const ventaIds = ventasDelDia.map((v) => v.id)

  // Ronda 2: top productos + productos vendidos del día + productos vendidos ayer
  const [itemsAgrupados, prodVendidosDia, prodVendidosAyer] = await Promise.all([
    ventaIds.length > 0
      ? prisma.itemVenta.groupBy({
          by:      ['productoId'],
          where:   { ventaId: { in: ventaIds } },
          _sum:    { cantidad: true, subtotal: true },
          orderBy: { _sum: { subtotal: 'desc' } },
          take:    5,
        })
      : Promise.resolve([]),
    ventaIds.length > 0
      ? prisma.itemVenta.aggregate({
          where: { ventaId: { in: ventaIds } },
          _sum:  { cantidad: true },
        })
      : Promise.resolve({ _sum: { cantidad: null as number | null } }),
    prisma.itemVenta.aggregate({
      where: { venta: { tenantId, estado: 'COMPLETADA', creadoEn: { gte: desdeAyer, lte: hastaAyer } } },
      _sum:  { cantidad: true },
    }),
  ])

  // Ronda 3: nombres de productos para el top
  const productoIds = itemsAgrupados.map((i) => i.productoId)
  const productos =
    productoIds.length > 0
      ? await prisma.producto.findMany({
          where:  { id: { in: productoIds } },
          select: { id: true, nombre: true },
        })
      : []
  const productoMap = new Map(productos.map((p) => [p.id, p.nombre]))

  // Agrupar ventas por hora en JS (< 1000 ventas/día — aceptable según spec)
  const horasMap = new Map<number, { total: number; cantidad: number }>()
  for (const v of ventasDelDia) {
    const hora = v.creadoEn.getUTCHours()
    const prev = horasMap.get(hora) ?? { total: 0, cantidad: 0 }
    horasMap.set(hora, { total: prev.total + v.total.toNumber(), cantidad: prev.cantidad + 1 })
  }
  const ventasPorHora = Array.from(horasMap.entries())
    .map(([hora, d]) => ({ hora, total: round2(d.total), cantidad: d.cantidad }))
    .sort((a, b) => a.hora - b.hora)

  // KPIs
  const hayAyer    = (agregadosAyer._count._all ?? 0) > 0
  const totalDia   = agregadosDia._sum.total?.toNumber()  ?? 0
  const totalAyer  = agregadosAyer._sum.total?.toNumber() ?? 0
  const cantDia    = agregadosDia._count._all             ?? 0
  const cantAyer   = agregadosAyer._count._all            ?? 0
  const ticketDia  = agregadosDia._avg.total?.toNumber()  ?? 0
  const ticketAyer = agregadosAyer._avg.total?.toNumber() ?? 0
  const prodDia    = prodVendidosDia._sum.cantidad         ?? 0
  const prodAyer   = prodVendidosAyer._sum.cantidad        ?? 0

  return c.json({
    fecha: desdeDia.toISOString().slice(0, 10),
    kpis: {
      totalFacturado:    { valor: round2(totalDia),  deltaVsAyer: calcDelta(totalDia,  totalAyer,  hayAyer) },
      cantidadVentas:    { valor: cantDia,            deltaVsAyer: calcDelta(cantDia,   cantAyer,   hayAyer) },
      ticketPromedio:    { valor: round2(ticketDia),  deltaVsAyer: calcDelta(ticketDia, ticketAyer, hayAyer) },
      productosVendidos: { valor: prodDia,            deltaVsAyer: calcDelta(prodDia,   prodAyer,   hayAyer) },
    },
    ventasPorHora,
    topProductos: itemsAgrupados.map((i) => ({
      productoId: i.productoId,
      nombre:     productoMap.get(i.productoId) ?? 'Producto eliminado',
      cantidad:   i._sum.cantidad ?? 0,
      total:      round2(i._sum.subtotal?.toNumber() ?? 0),
    })),
  })
})

// ── GET /reportes/cierre-caja/:cajaId ────────────────────────────────────────

/**
 * Reporte completo de una caja: totales, desglose por método de pago, top
 * productos, comparativo semanal y gastos. Funciona con cajas abiertas o cerradas.
 *
 * 404 si la caja no existe o no pertenece al tenant.
 */
reportesRoutes.get('/cierre-caja/:cajaId', async (c) => {
  const tenantId = c.get('tenantId')
  const { cajaId } = c.req.param()

  const caja = await prisma.caja.findFirst({ where: { id: cajaId, tenantId } })
  if (!caja) return c.json({ error: 'Caja no encontrada' }, 404)

  // Ronda 1: queries independientes de los IDs de ventas
  const fechaFin = caja.cierre ?? new Date()
  const { desde, hasta } = getUltimos7Dias(fechaFin)

  const [agregados, desglosePagosRaw, gastosTotales, ventaIdRows, comparativoSemanal] =
    await Promise.all([
      prisma.venta.aggregate({
        where: { cajaId, tenantId, estado: 'COMPLETADA' },
        _sum:   { total: true },
        _count: { _all: true },
        _avg:   { total: true },
      }),
      prisma.venta.groupBy({
        by:     ['metodoPago'],
        where:  { cajaId, tenantId, estado: 'COMPLETADA' },
        _sum:   { total: true },
        _count: { _all: true },
      }),
      prisma.gasto.aggregate({
        where: { cajaId },
        _sum:   { monto: true },
        _count: { _all: true },
      }),
      prisma.venta.findMany({
        where:  { cajaId, tenantId, estado: 'COMPLETADA' },
        select: { id: true },
      }),
      queryComparativoSemanal(tenantId, desde, hasta),
    ])

  const ids = ventaIdRows.map((v) => v.id)

  // Ronda 2: top productos y productos vendidos totales
  const [itemsAgrupados, prodVendidosAgregado] = await Promise.all([
    ids.length > 0
      ? prisma.itemVenta.groupBy({
          by:      ['productoId'],
          where:   { ventaId: { in: ids } },
          _sum:    { cantidad: true, subtotal: true },
          orderBy: { _sum: { subtotal: 'desc' } },
          take:    5,
        })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.itemVenta.aggregate({
          where: { ventaId: { in: ids } },
          _sum:  { cantidad: true },
        })
      : Promise.resolve({ _sum: { cantidad: null as number | null } }),
  ])

  // Ronda 3: nombres de productos
  const productoIds = itemsAgrupados.map((i) => i.productoId)
  const productos =
    productoIds.length > 0
      ? await prisma.producto.findMany({
          where:  { id: { in: productoIds } },
          select: { id: true, nombre: true },
        })
      : []
  const productoMap = new Map(productos.map((p) => [p.id, p.nombre]))

  // Desglose de pagos + porcentaje
  const totalFacturado = agregados._sum.total?.toNumber() ?? 0
  const desglosePagos = desglosePagosRaw.map((g) => {
    const monto = g._sum.total?.toNumber() ?? 0
    return {
      metodo:     g.metodoPago,
      monto:      round2(monto),
      cantidad:   g._count._all,
      porcentaje: totalFacturado > 0 ? round2((monto / totalFacturado) * 100) : 0,
    }
  })

  return c.json({
    caja: {
      id:           caja.id,
      apertura:     caja.apertura,
      montoInicial: caja.montoInicial.toNumber(),
      estado:       caja.estado,
      cierre:       caja.cierre,
      montoCierre:  caja.montoCierre?.toNumber() ?? null,
    },
    totales: {
      totalFacturado:    round2(totalFacturado),
      cantidadVentas:    agregados._count._all ?? 0,
      ticketPromedio:    round2(agregados._avg.total?.toNumber() ?? 0),
      productosVendidos: prodVendidosAgregado._sum.cantidad ?? 0,
    },
    desglosePagos,
    topProductos: itemsAgrupados.map((i) => ({
      productoId: i.productoId,
      nombre:     productoMap.get(i.productoId) ?? 'Producto eliminado',
      cantidad:   i._sum.cantidad ?? 0,
      total:      round2(i._sum.subtotal?.toNumber() ?? 0),
    })),
    comparativoSemanal,
    gastos: {
      total:    round2(gastosTotales._sum.monto?.toNumber() ?? 0),
      cantidad: gastosTotales._count._all ?? 0,
    },
  })
})

// ── GET /reportes/comparativo-semanal ────────────────────────────────────────

/**
 * Ventas agrupadas por día para los últimos 7 días.
 * Los días sin ventas se incluyen con total: 0.
 *
 * Query param: fechaFin (YYYY-MM-DD, default: hoy UTC)
 */
reportesRoutes.get('/comparativo-semanal', zvQuery(comparativoSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { fechaFin: fechaFinStr } = c.req.valid('query')

  const fechaFin = fechaFinStr ? parseFechaUTC(fechaFinStr) : new Date()
  const { desde, hasta } = getUltimos7Dias(fechaFin)

  const dias = await queryComparativoSemanal(tenantId, desde, hasta)
  const totalSemana = round2(dias.reduce((acc, d) => acc + d.total, 0))
  const promedio    = round2(totalSemana / 7)

  return c.json({ dias, promedio, totalSemana })
})

// ── GET /reportes/ventas-agregadas ───────────────────────────────────────────

/**
 * Agregación flexible para sparklines, breakdown de métodos de pago y heatmap.
 *
 * Query params:
 *   desde   (YYYY-MM-DD, requerido)
 *   hasta   (YYYY-MM-DD, requerido)
 *   agrupar ('hora' | 'dia' | 'metodo', requerido)
 *   estado  ('COMPLETADA' | 'ANULADA' | 'PENDIENTE', default: COMPLETADA)
 *
 * Validaciones: desde > hasta → 422 | rango > 366 días → 422
 */
reportesRoutes.get('/ventas-agregadas', zvQuery(ventasAgregadasSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { desde: desdeStr, hasta: hastaStr, agrupar, estado } = c.req.valid('query')

  const desdeDate = parseFechaUTC(desdeStr)
  desdeDate.setUTCHours(0, 0, 0, 0)
  const hastaDate = parseFechaUTC(hastaStr)
  hastaDate.setUTCHours(23, 59, 59, 999)

  // ── agrupar=hora: heatmap día de semana × hora ──────────────────────────────
  if (agrupar === 'hora') {
    type RawHoraRow = { diaSemana: number; hora: number; total: number; cantidad: number }
    const rows = await prisma.$queryRaw<RawHoraRow[]>`
      SELECT
        EXTRACT(DOW  FROM "creadoEn")::int AS "diaSemana",
        EXTRACT(HOUR FROM "creadoEn")::int AS hora,
        SUM(total)::float8                 AS total,
        COUNT(*)::int                      AS cantidad
      FROM "Venta"
      WHERE "tenantId" = ${tenantId}
        AND estado     = ${estado}::"EstadoVenta"
        AND "creadoEn" >= ${desdeDate}
        AND "creadoEn" <= ${hastaDate}
      GROUP BY "diaSemana", hora
      ORDER BY "diaSemana", hora
    `
    return c.json({
      agrupacion: 'hora' as const,
      data: rows.map((r) => ({ ...r, total: round2(r.total) })),
    })
  }

  // ── agrupar=dia: sparkline por fecha ─────────────────────────────────────────
  if (agrupar === 'dia') {
    const dias = await queryComparativoSemanal(tenantId, desdeDate, hastaDate, estado)
    return c.json({
      agrupacion: 'dia' as const,
      data: dias.map(({ fecha, total, cantidadVentas: cantidad }) => ({ fecha, total, cantidad })),
    })
  }

  // ── agrupar=metodo: breakdown por método de pago ─────────────────────────────
  const grupos = await prisma.venta.groupBy({
    by:     ['metodoPago'],
    where:  { tenantId, estado, creadoEn: { gte: desdeDate, lte: hastaDate } },
    _sum:   { total: true },
    _count: { _all: true },
  })
  const totalGeneral = grupos.reduce((acc, g) => acc + (g._sum.total?.toNumber() ?? 0), 0)

  return c.json({
    agrupacion: 'metodo' as const,
    data: grupos.map((g) => {
      const total = g._sum.total?.toNumber() ?? 0
      return {
        metodoPago: g.metodoPago,
        total:      round2(total),
        cantidad:   g._count._all,
        porcentaje: totalGeneral > 0 ? round2((total / totalGeneral) * 100) : 0,
      }
    }),
  })
})

export default reportesRoutes
