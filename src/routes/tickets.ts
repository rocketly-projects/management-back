import { Hono }      from 'hono'
import { z }          from 'zod'
import { prisma }     from '../lib/prisma.js'
import { zv }         from '../lib/validator.js'

type Variables = { tenantId: string; email: string }

// ── Schemas ───────────────────────────────────────────────────────────────────

const imprimirSchema = z.object({
  conexion: z.enum(['network', 'usb']).default('network'),
  ip:       z.string().optional(),
  puerto:   z.number().int().positive().default(9100),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const METODO_LABEL: Record<string, string> = {
  EFECTIVO:      'EFECTIVO',
  DEBITO:        'TARJETA DEBITO',
  CREDITO:       'TARJETA CREDITO',
  TRANSFERENCIA: 'TRANSFERENCIA',
  MERCADO_PAGO:  'MERCADO PAGO',
  FIADO:         'FIADO - CUENTA CORRIENTE',
}

// Ancho de papel: 42 chars (80mm, font A)
const ANCHO = 42

function sepFull()  { return '-'.repeat(ANCHO) }
function sepThin()  { return '.'.repeat(ANCHO) }

function lineaCols(izq: string, der: string): string {
  const espacios = ANCHO - izq.length - der.length
  return izq + ' '.repeat(Math.max(1, espacios)) + der
}

// ── Rutas ─────────────────────────────────────────────────────────────────────

const ticketsRoutes = new Hono<{ Variables: Variables }>()

/**
 * GET /tickets/:ventaId
 * Datos completos del ticket para el modal de previsualización en el front.
 */
ticketsRoutes.get('/:ventaId', async (c) => {
  const tenantId   = c.get('tenantId')
  const { ventaId } = c.req.param()

  const [venta, tenant, perfil] = await Promise.all([
    prisma.venta.findFirst({
      where:   { id: ventaId, tenantId },
      include: {
        items: {
          include: { producto: { select: { id: true, nombre: true, sku: true } } },
        },
        cliente: { select: { id: true, nombre: true } },
      },
    }),
    prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { nombre: true, nombreDisplay: true },
    }),
    prisma.perfil.findUnique({
      where:  { tenantId },
      select: { taxId: true, telefono: true, direccion: true, logo: true },
    }),
  ])

  if (!venta) return c.json({ error: 'Venta no encontrada' }, 404)

  const subtotal = venta.items.reduce((s, i) => s + i.subtotal.toNumber(), 0)

  return c.json({
    negocio: {
      nombre:    tenant?.nombreDisplay ?? tenant?.nombre ?? '',
      taxId:     perfil?.taxId     ?? null,
      telefono:  perfil?.telefono  ?? null,
      direccion: perfil?.direccion ?? null,
      logo:      perfil?.logo      ?? null,
    },
    venta: {
      id:         venta.id,
      numero:     venta.numero,
      subtotal,
      total:      venta.total.toNumber(),
      descuento:  venta.descuento.toNumber(),
      metodoPago: venta.metodoPago,
      estado:     venta.estado,
      creadoEn:   venta.creadoEn,
      cliente:    venta.cliente ?? null,
      items:      venta.items.map((i) => ({
        id:             i.id,
        cantidad:       i.cantidad,
        precioUnitario: i.precioUnitario.toNumber(),
        subtotal:       i.subtotal.toNumber(),
        producto:       i.producto,
      })),
    },
  })
})

/**
 * POST /tickets/:ventaId/imprimir
 * Construye el ticket en ESC/POS y lo envía a la impresora térmica.
 *
 * Body:
 *   - conexion: "network" | "usb"  (default: "network")
 *   - ip:       string             (requerido si conexion = "network")
 *   - puerto:   number             (default: 9100)
 *
 * Para conexión USB: la impresora debe estar conectada por USB a la misma
 * máquina que corre este servidor. En Windows puede requerir driver libusb.
 *
 * Para conexión de red: la impresora debe tener IP fija en la misma LAN.
 */
ticketsRoutes.post('/:ventaId/imprimir', zv(imprimirSchema), async (c) => {
  const tenantId   = c.get('tenantId')
  const { ventaId } = c.req.param()
  const { conexion, ip, puerto } = c.req.valid('json')

  if (conexion === 'network' && !ip) {
    return c.json({ error: 'Se requiere el campo "ip" para conexión de red' }, 400)
  }

  // Traer todos los datos necesarios en paralelo
  const [venta, tenant, perfil] = await Promise.all([
    prisma.venta.findFirst({
      where:   { id: ventaId, tenantId },
      include: {
        items: {
          include: { producto: { select: { id: true, nombre: true, sku: true } } },
        },
      },
    }),
    prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { nombre: true, nombreDisplay: true },
    }),
    prisma.perfil.findUnique({
      where:  { tenantId },
      select: { taxId: true, telefono: true, direccion: true },
    }),
  ])

  if (!venta) return c.json({ error: 'Venta no encontrada' }, 404)

  try {
    const { Printer }              = await import('@node-escpos/core')
    let device: any

    if (conexion === 'network') {
      const { default: Network } = await import('@node-escpos/network-adapter')
      device = new Network(ip!, puerto)
    } else {
      const { default: USB } = await import('@node-escpos/usb-adapter')
      device = new USB()
    }

    // Abrir conexión (callback → Promise)
    await new Promise<void>((resolve, reject) => {
      device.open((err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })

    const printer = new Printer(device, { encoding: 'utf-8', width: ANCHO })

    // ── Datos del ticket ──────────────────────────────────────────
    const nombreNegocio = tenant?.nombreDisplay ?? tenant?.nombre ?? 'Mi Negocio'
    const fecha = new Date(venta.creadoEn).toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
    const hora = new Date(venta.creadoEn).toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit',
    })
    const numeroStr = `#${String(venta.numero).padStart(4, '0')}`
    const descuento = venta.descuento.toNumber()
    const total     = venta.total.toNumber()
    const subtotal  = venta.items.reduce((s, i) => s + i.subtotal.toNumber(), 0)

    // ── Encabezado ────────────────────────────────────────────────
    printer
      .align('CT')
      .style('B')
      .size(2, 1)
      .text(nombreNegocio.substring(0, 21)) // 42/2 = 21 chars en doble ancho
      .size(1, 1)
      .style('NORMAL')

    if (perfil?.taxId)     printer.text(`CUIT: ${perfil.taxId}`)
    if (perfil?.direccion) printer.text(perfil.direccion.substring(0, ANCHO))
    if (perfil?.telefono)  printer.text(`Tel: ${perfil.telefono}`)

    // ── Número y fecha ────────────────────────────────────────────
    printer
      .text(sepFull())
      .align('LT')
      .text(lineaCols(`Ticket ${numeroStr}`, `${fecha} ${hora}`))
      .text(sepFull())

    // ── Items ─────────────────────────────────────────────────────
    for (const item of venta.items) {
      const nombre    = item.producto.nombre.substring(0, ANCHO)
      const cant      = item.cantidad
      const precio    = item.precioUnitario.toNumber()
      const sub       = item.subtotal.toNumber()
      const precioFmt = `$${precio.toLocaleString('es-AR')}`
      const subFmt    = `$${sub.toLocaleString('es-AR')}`
      const detalle   = `  ${cant} x ${precioFmt}`

      printer
        .text(nombre)
        .text(lineaCols(detalle, subFmt))
    }

    // ── Totales ───────────────────────────────────────────────────
    printer.text(sepFull())

    if (descuento > 0) {
      const subFmt = `$${subtotal.toLocaleString('es-AR')}`
      const dscFmt = `-$${descuento.toLocaleString('es-AR')}`
      printer
        .text(lineaCols('Subtotal:', subFmt))
        .text(lineaCols('Descuento:', dscFmt))
    }

    const totalFmt = `$${total.toLocaleString('es-AR')}`
    printer
      .style('B')
      .size(1, 2)                                            // doble alto
      .text(lineaCols('TOTAL:', totalFmt))
      .size(1, 1)
      .style('NORMAL')
      .text(sepFull())

    // ── Método de pago + cierre ───────────────────────────────────
    printer
      .align('CT')
      .text(METODO_LABEL[venta.metodoPago] ?? venta.metodoPago)
      .text(sepThin())
      .text('Gracias por su compra!')
      .feed(4)
      .cut()

    await printer.close()

    return c.json({ ok: true, message: 'Ticket impreso correctamente' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido al imprimir'
    console.error('[tickets] Error de impresión:', err)
    return c.json({ error: `Error al imprimir: ${msg}` }, 500)
  }
})

export default ticketsRoutes
