import { Hono } from 'hono'
import { z } from 'zod'
import type { Venta, ItemVenta, Producto } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { zv, zvQuery } from '../lib/validator'

type Variables = { tenantId: string; email: string }

// ── Error interno para abortar transacciones con respuesta HTTP ───────────────

class BusinessError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message)
    this.name = 'BusinessError'
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  productoId: z.string().min(1, 'productoId es requerido'),
  cantidad:   z.number().int().positive('La cantidad debe ser mayor a 0'),
})

const ventaSchema = z
  .object({
    items:      z.array(itemSchema).min(1, 'La venta debe tener al menos un item'),
    descuento:  z.number().min(0, 'El descuento no puede ser negativo').default(0),
    metodoPago: z.enum(
      ['EFECTIVO', 'DEBITO', 'CREDITO', 'TRANSFERENCIA', 'MERCADO_PAGO'],
      { required_error: 'El método de pago es requerido' },
    ),
  })
  .refine(
    (d) => new Set(d.items.map((i) => i.productoId)).size === d.items.length,
    { message: 'No puede haber productos duplicados en la misma venta', path: ['items'] },
  )

const querySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  estado: z.enum(['COMPLETADA', 'ANULADA', 'PENDIENTE']).optional(),
  cajaId: z.string().optional(),
  desde:  z.string().datetime({ message: 'desde debe ser una fecha ISO 8601 válida' }).optional(),
  hasta:  z.string().datetime({ message: 'hasta debe ser una fecha ISO 8601 válida' }).optional(),
})

// ── Tipos internos ────────────────────────────────────────────────────────────

type VentaWithItems = Venta & {
  items: (ItemVenta & { producto: Pick<Producto, 'id' | 'nombre' | 'sku'> })[]
}

// ── Serialización (Decimal → number) ─────────────────────────────────────────

function serializeItem(item: ItemVenta & { producto: Pick<Producto, 'id' | 'nombre' | 'sku'> }) {
  return {
    ...item,
    precioUnitario: item.precioUnitario.toNumber(),
    subtotal:       item.subtotal.toNumber(),
  }
}

function serializeVenta(v: VentaWithItems) {
  return {
    ...v,
    total:     v.total.toNumber(),
    descuento: v.descuento.toNumber(),
    items:     v.items.map(serializeItem),
  }
}

function serializeVentaSummary(v: Venta) {
  return {
    ...v,
    total:     v.total.toNumber(),
    descuento: v.descuento.toNumber(),
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const ventasRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /ventas
 * Lista ventas del tenant con paginación.
 * Query params: page, limit, estado, cajaId
 */
ventasRoutes.get('/', zvQuery(querySchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { page, limit, estado, cajaId, desde, hasta } = c.req.valid('query')

  const where = {
    tenantId,
    ...(estado ? { estado } : {}),
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

  const [ventas, total] = await prisma.$transaction([
    prisma.venta.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.venta.count({ where }),
  ])

  return c.json({
    data:       ventas.map(serializeVentaSummary),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  })
})

/**
 * GET /ventas/:id
 * Retorna una venta con sus items y datos del producto.
 * 404 si no existe o no pertenece al tenant.
 */
ventasRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const { id }   = c.req.param()

  const venta = await prisma.venta.findFirst({
    where: { id, tenantId },
    include: {
      items: {
        include: {
          producto: { select: { id: true, nombre: true, sku: true } },
        },
      },
    },
  })

  if (!venta) return c.json({ error: 'Venta no encontrada' }, 404)

  return c.json(serializeVenta(venta))
})

/**
 * POST /ventas
 * Crea una venta dentro de una transacción atómica:
 *   1. Verifica caja abierta del tenant.
 *   2. Carga los productos (deben existir, ser activos y pertenecer al tenant).
 *   3. Valida stock suficiente.
 *   4. Calcula totales server-side (precio histórico del DB).
 *   5. Valida que descuento ≤ subtotal.
 *   6. Genera número autoincremental por tenant.
 *   7. Crea Venta + ItemVenta en un solo create anidado.
 *   8. Decrementa stock de cada producto.
 */
ventasRoutes.post('/', zv(ventaSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { items, descuento, metodoPago } = c.req.valid('json')

  try {
    const venta = await prisma.$transaction(async (tx) => {
      // 1. Caja abierta
      const caja = await tx.caja.findFirst({ where: { tenantId, estado: 'ABIERTA' } })
      if (!caja) throw new BusinessError(400, 'No hay una caja abierta para registrar la venta')

      // 2. Cargar productos
      const ids       = items.map((i: { productoId: string; cantidad: number }) => i.productoId)
      const productos = await tx.producto.findMany({
        where: { id: { in: ids }, tenantId, activo: true },
      })

      if (productos.length !== ids.length) {
        const found   = new Set(productos.map((p) => p.id))
        const missing = ids.filter((id: string) => !found.has(id))
        throw new BusinessError(404, `Productos no encontrados o inactivos: ${missing.join(', ')}`)
      }

      const productoMap = new Map(productos.map((p) => [p.id, p]))

      // 3. Validar stock + 4. Calcular subtotales
      let subtotal = 0
      const itemsData: {
        productoId:     string
        cantidad:       number
        precioUnitario: number
        subtotal:       number
      }[] = []

      for (const item of items) {
        const producto = productoMap.get(item.productoId)!
        if (producto.stock < item.cantidad) {
          throw new BusinessError(
            400,
            `Stock insuficiente para "${producto.nombre}": disponible ${producto.stock}, solicitado ${item.cantidad}`,
          )
        }
        const precioUnitario = producto.precio.toNumber()
        const itemSubtotal   = Math.round(precioUnitario * item.cantidad * 100) / 100
        subtotal            += itemSubtotal
        itemsData.push({ productoId: item.productoId, cantidad: item.cantidad, precioUnitario, subtotal: itemSubtotal })
      }

      // 5. Descuento ≤ subtotal
      if (descuento > subtotal) {
        throw new BusinessError(400, `El descuento (${descuento}) no puede superar el subtotal (${subtotal})`)
      }
      const total = Math.round((subtotal - descuento) * 100) / 100

      // 6. Número autoincremental por tenant
      const ultima = await tx.venta.findFirst({
        where:   { tenantId },
        orderBy: { numero: 'desc' },
        select:  { numero: true },
      })
      const numero = (ultima?.numero ?? 0) + 1

      // 7. Crear Venta + Items
      const nuevaVenta = await tx.venta.create({
        data: {
          tenantId,
          cajaId: caja.id,
          numero,
          total,
          descuento,
          metodoPago,
          items: {
            create: itemsData,
          },
        },
        include: {
          items: {
            include: {
              producto: { select: { id: true, nombre: true, sku: true } },
            },
          },
        },
      })

      // 8. Decrementar stock
      await Promise.all(
        items.map((item: { productoId: string; cantidad: number }) =>
          tx.producto.update({
            where: { id: item.productoId },
            data:  { stock: { decrement: item.cantidad } },
          }),
        ),
      )

      return nuevaVenta
    })

    return c.json(serializeVenta(venta as VentaWithItems), 201)
  } catch (err) {
    if (err instanceof BusinessError) {
      return c.json({ error: err.message }, err.status)
    }
    throw err
  }
})

/**
 * POST /ventas/:id/anular
 * Anula una venta COMPLETADA y restaura el stock.
 * 404 si no existe o no pertenece al tenant.
 * 400 si ya está anulada o en estado PENDIENTE.
 */
ventasRoutes.post('/:id/anular', async (c) => {
  const tenantId = c.get('tenantId')
  const { id }   = c.req.param()

  try {
    const venta = await prisma.$transaction(async (tx) => {
      const ventaExistente = await tx.venta.findFirst({
        where:   { id, tenantId },
        include: { items: true },
      })

      if (!ventaExistente) throw new BusinessError(404, 'Venta no encontrada')
      if (ventaExistente.estado !== 'COMPLETADA') {
        throw new BusinessError(400, `No se puede anular una venta en estado ${ventaExistente.estado}`)
      }

      // Restaurar stock
      await Promise.all(
        ventaExistente.items.map((item) =>
          tx.producto.update({
            where: { id: item.productoId },
            data:  { stock: { increment: item.cantidad } },
          }),
        ),
      )

      return tx.venta.update({
        where: { id },
        data:  { estado: 'ANULADA' },
        include: {
          items: {
            include: {
              producto: { select: { id: true, nombre: true, sku: true } },
            },
          },
        },
      })
    })

    return c.json(serializeVenta(venta as VentaWithItems))
  } catch (err) {
    if (err instanceof BusinessError) {
      return c.json({ error: err.message }, err.status)
    }
    throw err
  }
})

export default ventasRoutes
