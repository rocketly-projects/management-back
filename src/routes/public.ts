import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'

const publicRoutes = new Hono()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findTenantByNombre(nombre: string) {
  return prisma.tenant.findUnique({
    where: { nombre },
    include: { perfil: true },
  })
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /public/:nombre
 * Retorna el perfil público del negocio.
 */
publicRoutes.get('/:nombre', async (c) => {
  const nombre = c.req.param('nombre')

  const tenant = await findTenantByNombre(nombre)
  if (!tenant || !tenant.activo) {
    return c.json({ message: 'Negocio no encontrado' }, 404)
  }

  return c.json({
    nombre: tenant.nombre,
    nombreDisplay: tenant.nombreDisplay,
    logo: tenant.perfil?.logo ?? null,
    telefono: tenant.perfil?.telefono ?? null,
    direccion: tenant.perfil?.direccion ?? null,
    moneda: tenant.perfil?.moneda ?? 'ARS',
  })
})

/**
 * GET /public/:nombre/productos
 * Retorna productos activos del tenant.
 * Query params opcionales: categoria, busqueda
 */
publicRoutes.get('/:nombre/productos', async (c) => {
  const nombre = c.req.param('nombre')
  const categoria = c.req.query('categoria')
  const busqueda = c.req.query('busqueda')

  const tenant = await prisma.tenant.findUnique({ where: { nombre }, select: { id: true, activo: true } })
  if (!tenant || !tenant.activo) {
    return c.json({ message: 'Negocio no encontrado' }, 404)
  }

  const productos = await prisma.producto.findMany({
    where: {
      tenantId: tenant.id,
      activo: true,
      ...(categoria ? { categoria } : {}),
      ...(busqueda
        ? {
            OR: [
              { nombre: { contains: busqueda, mode: 'insensitive' } },
              { marca: { contains: busqueda, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      nombre: true,
      marca: true,
      precio: true,
      categoria: true,
      imagen: true,
      stock: true,
    },
    orderBy: { nombre: 'asc' },
  })

  return c.json(
    productos.map((p) => ({ ...p, precio: Number(p.precio) })),
  )
})

/**
 * GET /public/:nombre/productos/categorias
 * Retorna categorías distintas y no nulas del tenant.
 */
publicRoutes.get('/:nombre/productos/categorias', async (c) => {
  const nombre = c.req.param('nombre')

  const tenant = await prisma.tenant.findUnique({ where: { nombre }, select: { id: true, activo: true } })
  if (!tenant || !tenant.activo) {
    return c.json({ message: 'Negocio no encontrado' }, 404)
  }

  const rows = await prisma.producto.findMany({
    where: { tenantId: tenant.id, activo: true, categoria: { not: null } },
    select: { categoria: true },
    distinct: ['categoria'],
    orderBy: { categoria: 'asc' },
  })

  return c.json(rows.map((r) => r.categoria as string))
})

export default publicRoutes
