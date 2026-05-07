import { Hono } from 'hono'
import { z } from 'zod'
import type { Cliente } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { zv, zvQuery } from '../lib/validator.js'
import { calcularDeuda } from '../lib/deuda.js'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const clienteSchema = z.object({
  nombre:    z.string().min(1, 'El nombre es requerido'),
  email:     z.string().email('Email inválido').optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  telefono:  z.string().optional(),
  direccion: z.string().optional(),
  notas:     z.string().optional(),
})

const updateClienteSchema = clienteSchema.partial()

const querySchema = z.object({
  search:    z.string().optional(),
  conDeuda:  z.enum(['true', 'false']).optional(),
  activo:    z.enum(['true', 'false']).optional(),
})

// ── Serialización ─────────────────────────────────────────────────────────────

function serialize(c: Cliente) {
  return c
}

function serializeWithDeuda(c: Cliente, deuda: number) {
  return { ...c, deuda }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const clientesRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /clientes
 * Lista clientes del tenant. Por defecto solo activos.
 * Query: search (ILIKE en nombre), conDeuda=true, activo=true|false
 */
clientesRoutes.get('/', zvQuery(querySchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { search, conDeuda, activo } = c.req.valid('query')

  const where = {
    tenantId,
    activo: activo !== undefined ? activo === 'true' : true,
    ...(search
      ? { nombre: { contains: search, mode: 'insensitive' as const } }
      : {}),
  }

  const clientes = await prisma.cliente.findMany({
    where,
    orderBy: { nombre: 'asc' },
  })

  // Si no se pidió deuda y no se filtra por deuda, devolver liso.
  if (!conDeuda) {
    return c.json(clientes.map(serialize))
  }

  // Adjuntar deuda y, si conDeuda=true, filtrar > 0.
  const conDeudaCalculada = await Promise.all(
    clientes.map(async (cli) => {
      const deuda = await calcularDeuda(cli.id, tenantId)
      return { cliente: cli, deuda: deuda.toNumber() }
    }),
  )

  const filtrados = conDeuda === 'true'
    ? conDeudaCalculada.filter(x => x.deuda > 0)
    : conDeudaCalculada

  return c.json(filtrados.map(({ cliente, deuda }) => serializeWithDeuda(cliente, deuda)))
})

/**
 * GET /clientes/:id
 * Devuelve el cliente con su deuda calculada.
 * 404 si no existe o no pertenece al tenant.
 */
clientesRoutes.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const cliente = await prisma.cliente.findFirst({ where: { id, tenantId } })
  if (!cliente) return c.json({ error: 'Cliente no encontrado' }, 404)

  const deuda = await calcularDeuda(id, tenantId)
  return c.json(serializeWithDeuda(cliente, deuda.toNumber()))
})

/**
 * GET /clientes/:id/cuenta
 * Estado de cuenta: deuda + movimientos (ventas fiadas + pagos) ordenados por fecha desc.
 */
clientesRoutes.get('/:id/cuenta', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const cliente = await prisma.cliente.findFirst({ where: { id, tenantId } })
  if (!cliente) return c.json({ error: 'Cliente no encontrado' }, 404)

  const [ventasFiadas, pagos, deuda] = await Promise.all([
    prisma.venta.findMany({
      where: {
        tenantId,
        clienteId: id,
        metodoPago: 'FIADO',
        estado: { not: 'ANULADA' },
      },
      select: { id: true, numero: true, total: true, creadoEn: true, estado: true },
    }),
    prisma.pagoFiado.findMany({
      where: { tenantId, clienteId: id },
      select: { id: true, monto: true, metodoPago: true, ventaId: true, notas: true, creadoEn: true },
    }),
    calcularDeuda(id, tenantId),
  ])

  const movimientos = [
    ...ventasFiadas.map(v => ({
      tipo:       'VENTA_FIADO' as const,
      id:         v.id,
      fecha:      v.creadoEn,
      monto:      v.total.toNumber(),
      ventaNumero: v.numero,
      estado:     v.estado,
    })),
    ...pagos.map(p => ({
      tipo:       'PAGO_FIADO' as const,
      id:         p.id,
      fecha:      p.creadoEn,
      monto:      p.monto.toNumber(),
      metodoPago: p.metodoPago,
      ventaId:    p.ventaId,
      notas:      p.notas,
    })),
  ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime())

  return c.json({
    cliente: serialize(cliente),
    deuda:   deuda.toNumber(),
    movimientos,
  })
})

/**
 * POST /clientes
 * Crea un cliente. Solo `nombre` es obligatorio.
 */
clientesRoutes.post('/', zv(clienteSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const data = c.req.valid('json')

  const cliente = await prisma.cliente.create({
    data: { ...data, tenantId },
  })

  return c.json(serialize(cliente), 201)
})

/**
 * PATCH /clientes/:id
 */
clientesRoutes.patch('/:id', zv(updateClienteSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()
  const data = c.req.valid('json')

  const existing = await prisma.cliente.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Cliente no encontrado' }, 404)

  const cliente = await prisma.cliente.update({ where: { id }, data })
  return c.json(serialize(cliente))
})

/**
 * DELETE /clientes/:id
 * Soft delete: setea activo = false.
 */
clientesRoutes.delete('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()

  const existing = await prisma.cliente.findFirst({ where: { id, tenantId } })
  if (!existing) return c.json({ error: 'Cliente no encontrado' }, 404)

  await prisma.cliente.update({ where: { id }, data: { activo: false } })
  return c.json({ message: 'Cliente desactivado' })
})

export default clientesRoutes
