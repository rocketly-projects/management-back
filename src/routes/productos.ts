import { Hono } from 'hono'
import { z } from 'zod'
import type { Producto } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { zv, zvQuery } from '../lib/validator.js'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const productoSchema = z.object({
  sku:        z.string().optional(),
  nombre:     z.string().min(1, 'El nombre es requerido'),
  marca:      z.string().optional(),
  precio:     z.number({ required_error: 'El precio es requerido' })
               .positive('El precio debe ser mayor a 0'),
  costo:      z.number().positive('El costo debe ser mayor a 0').optional(),
  stock:      z.number().int().min(0).default(0),
  stockAlert: z.number().int().min(0).default(5),
  categoria:  z.string().optional(),
  imagen:     z.string().url('URL de imagen inválida').optional(),
  activo:     z.boolean().default(true),
})

const updateProductoSchema = productoSchema.partial()

const querySchema = z.object({
  categoria: z.string().optional(),
  activo:    z.enum(['true', 'false']).optional(),
  busqueda:  z.string().optional(),
})

// ── Serialización (Decimal → number) ─────────────────────────────────────────

function serialize(p: Producto) {
  return {
    ...p,
    precio: p.precio.toNumber(),
    costo:  p.costo?.toNumber() ?? null,
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const productosRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /productos
 * Lista productos del tenant. Por defecto solo activos.
 * Query params opcionales: categoria, activo (true|false), busqueda
 */
productosRoutes.get('/', zvQuery(querySchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { categoria, activo, busqueda } = c.req.valid('query')

  const where = {
    tenantId,
    activo: activo !== undefined ? activo === 'true' : true,
    ...(categoria ? { categoria } : {}),
    ...(busqueda
      ? {
          OR: [
            { nombre: { contains: busqueda, mode: 'insensitive' as const } },
            { sku:    { contains: busqueda, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const productos = await prisma.producto.findMany({
    where,
    orderBy: { nombre: 'asc' },
  })

  return c.json(productos.map(serialize))
})

/**
 * GET /productos/:id
 * Retorna un producto independientemente de su estado activo/inactivo.
 * 404 si no existe o no pertenece al tenant.
 * (Inactivos se devuelven para permitir reactivación desde el admin.)
 */
productosRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const producto = await prisma.producto.findFirst({ where: { id, tenantId } })
  if (!producto) return c.json({ error: 'Producto no encontrado' }, 404)

  return c.json(serialize(producto))
})

/**
 * POST /productos
 * Crea un producto nuevo para el tenant.
 */
productosRoutes.post('/', zv(productoSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const data = c.req.valid('json')

  const producto = await prisma.producto.create({
    data: { ...data, tenantId },
  })

  return c.json(serialize(producto), 201)
})

/**
 * PUT /productos/:id
 * Actualiza un producto. 404 si no existe o no pertenece al tenant.
 */
productosRoutes.put('/:id', zv(updateProductoSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()
  const data = c.req.valid('json')

  const existing = await prisma.producto.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Producto no encontrado' }, 404)

  const producto = await prisma.producto.update({ where: { id }, data })
  return c.json(serialize(producto))
})

/**
 * DELETE /productos/:id
 * Soft delete: setea activo = false. Nunca elimina el registro.
 * 404 si no existe o no pertenece al tenant.
 */
productosRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const existing = await prisma.producto.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Producto no encontrado' }, 404)

  await prisma.producto.update({ where: { id }, data: { activo: false } })
  return c.json({ message: 'Producto desactivado' })
})

export default productosRoutes
