import { Hono } from 'hono'
import { z } from 'zod'
import type { Caja, Gasto } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { zv } from '../lib/validator.js'

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
