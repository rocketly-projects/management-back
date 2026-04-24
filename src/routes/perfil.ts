import { Hono } from 'hono'
import { z } from 'zod'
import type { Perfil } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { zv } from '../lib/validator'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const updatePerfilSchema = z.object({
  nombreNegocio: z.string().min(1, 'El nombre del negocio no puede estar vacío').optional(),
  nombreDueno:   z.string().optional(),
  telefono:      z.string().optional(),
  direccion:     z.string().optional(),
  taxId:         z.string().optional(),
  moneda:        z.string().length(3, 'La moneda debe ser un código de 3 letras (ej. ARS, USD)').optional(),
  logo:          z.string().url('URL de logo inválida').optional(),
})

// ── Serialización ─────────────────────────────────────────────────────────────

function serialize(p: Perfil) {
  return p
}

// ── Routes ────────────────────────────────────────────────────────────────────

const perfilRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /perfil
 * Retorna el perfil del tenant autenticado.
 * 404 si el perfil no existe (no debería ocurrir tras el registro).
 */
perfilRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')

  const perfil = await prisma.perfil.findUnique({ where: { tenantId } })
  if (!perfil) return c.json({ error: 'Perfil no encontrado' }, 404)

  return c.json(serialize(perfil))
})

/**
 * PUT /perfil
 * Actualiza los datos del perfil del tenant.
 * Solo los campos enviados se modifican (patch semántico).
 */
perfilRoutes.put('/', zv(updatePerfilSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const data     = c.req.valid('json')

  const existing = await prisma.perfil.findUnique({ where: { tenantId } })
  if (!existing) return c.json({ error: 'Perfil no encontrado' }, 404)

  const perfil = await prisma.perfil.update({ where: { tenantId }, data })
  return c.json(serialize(perfil))
})

export default perfilRoutes
