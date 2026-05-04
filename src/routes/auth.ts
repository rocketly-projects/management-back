import { Hono } from 'hono'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { signJwt } from '../lib/jwt.js'
import { zv } from '../lib/validator.js'

// ── Schemas ───────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  nombreNegocio: z.string().min(1, 'El nombre del negocio es requerido'),
  nombreDueno: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateSlug(nombre: string): string {
  const base =
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // elimina tildes
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'kiosco'
  return `${base}-${Date.now()}`
}

// Campos del tenant seguros para exponer (sin passwordHash)
const tenantSelect = {
  id: true,
  email: true,
  nombre: true,
  slug: true,
  plan: true,
  activo: true,
  creadoEn: true,
} as const

// ── Routes ────────────────────────────────────────────────────────────────────

const authRoutes = new Hono()

/**
 * POST /auth/register
 * Crea un nuevo tenant + perfil inicial en una transacción.
 * Retorna JWT + datos del tenant (sin passwordHash).
 */
authRoutes.post('/register', zv(registerSchema), async (c) => {
  const { email, password, nombreNegocio, nombreDueno } = c.req.valid('json')

  const passwordHash = await bcrypt.hash(password, 12)
  const slug = generateSlug(nombreNegocio)

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      return tx.tenant.create({
        data: {
          email,
          passwordHash,
          nombre: nombreNegocio,
          slug,
          perfil: {
            create: {
              nombreNegocio,
              nombreDueno: nombreDueno ?? null,
            },
          },
        },
        select: tenantSelect,
      })
    })

    const token = await signJwt({ tenantId: tenant.id, email: tenant.email })
    return c.json({ token, tenant }, 201)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return c.json({ error: 'El email ya está registrado' }, 409)
    }
    throw e
  }
})

/**
 * POST /auth/login
 * Valida credenciales y retorna JWT + datos del tenant.
 * El mensaje de error es genérico: no revela si falló email o password.
 */
authRoutes.post('/login', zv(loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const INVALID = { error: 'Credenciales inválidas' } as const

  const tenant = await prisma.tenant.findUnique({ where: { email } })
  if (!tenant) return c.json(INVALID, 401)

  const valid = await bcrypt.compare(password, tenant.passwordHash)
  if (!valid) return c.json(INVALID, 401)

  // Excluir passwordHash de la respuesta
  const { passwordHash: _, ...tenantPublic } = tenant
  const token = await signJwt({ tenantId: tenant.id, email: tenant.email })
  return c.json({ token, tenant: tenantPublic })
})

export default authRoutes
