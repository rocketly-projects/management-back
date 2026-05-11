import { Hono } from 'hono'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { zv } from '../lib/validator.js'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const updatePerfilSchema = z.object({
  nombreDueno: z.string().optional(),
  telefono:    z.string().optional(),
  direccion:   z.string().optional(),
  taxId:       z.string().optional(),
  moneda:      z.string().length(3, 'La moneda debe ser un código de 3 letras (ej. ARS, USD)').optional(),
  logo:        z.string().url('URL de logo inválida').optional(),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const tenantSelect = { nombre: true, nombreDisplay: true } as const

async function getPerfilConTenant(tenantId: string) {
  return prisma.perfil.findUnique({
    where: { tenantId },
    include: { tenant: { select: tenantSelect } },
  })
}

function serialize(perfil: NonNullable<Awaited<ReturnType<typeof getPerfilConTenant>>>) {
  const { tenant, ...perfilData } = perfil
  return {
    ...perfilData,
    tenantNombre: tenant.nombre,
    tenantNombreDisplay: tenant.nombreDisplay,
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const perfilRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /perfil
 * Retorna el perfil del tenant autenticado incluyendo nombre del negocio.
 */
perfilRoutes.get('/', async (c) => {
  const tenantId = c.get('tenantId')

  const perfil = await getPerfilConTenant(tenantId)
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

  const existing = await getPerfilConTenant(tenantId)
  if (!existing) return c.json({ error: 'Perfil no encontrado' }, 404)

  await prisma.perfil.update({ where: { tenantId }, data })

  const updated = await getPerfilConTenant(tenantId)
  return c.json(serialize(updated!))
})

export default perfilRoutes
