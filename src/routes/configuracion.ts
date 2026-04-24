import { Hono } from 'hono'
import { z } from 'zod'
import type { Configuracion } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { zv } from '../lib/validator'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const updateConfiguracionSchema = z.object({
  tema:        z.enum(['LIGHT', 'DARK']).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'El accentColor debe ser un color hex válido (ej. #2563eb)')
    .optional(),
})

// ── Serialización ─────────────────────────────────────────────────────────────

function serialize(c: Configuracion) {
  return c
}

// ── Routes ────────────────────────────────────────────────────────────────────

const configuracionRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /configuracion
 * Retorna la configuración del tenant.
 * Si aún no existe (tenant creado antes de esta feature), la crea con valores por defecto.
 */
configuracionRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')

  const configuracion = await prisma.configuracion.upsert({
    where:  { tenantId },
    update: {},
    create: { tenantId },
  })

  return c.json(serialize(configuracion))
})

/**
 * PUT /configuracion
 * Actualiza tema y/o accentColor del tenant.
 * Crea el registro si no existe (idempotente).
 */
configuracionRoutes.put('/', zv(updateConfiguracionSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const data     = c.req.valid('json')

  const configuracion = await prisma.configuracion.upsert({
    where:  { tenantId },
    update: data,
    create: { tenantId, ...data },
  })

  return c.json(serialize(configuracion))
})

export default configuracionRoutes
