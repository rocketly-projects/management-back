import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

/**
 * Calcula la deuda de fiado de un cliente del tenant.
 *
 *   deuda = SUM(Venta.total | metodoPago=FIADO, estado != ANULADA)
 *         - SUM(PagoFiado.monto)
 *
 * Devuelve un Prisma.Decimal con escala 2.
 */
export async function calcularDeuda(
  clienteId: string,
  tenantId: string,
): Promise<Prisma.Decimal> {
  const [ventasAgg, pagosAgg] = await prisma.$transaction([
    prisma.venta.aggregate({
      _sum: { total: true },
      where: {
        tenantId,
        clienteId,
        metodoPago: 'FIADO',
        estado: { not: 'ANULADA' },
      },
    }),
    prisma.pagoFiado.aggregate({
      _sum: { monto: true },
      where: { tenantId, clienteId },
    }),
  ])

  const totalFiado = ventasAgg._sum.total ?? new Prisma.Decimal(0)
  const totalPagos = pagosAgg._sum.monto ?? new Prisma.Decimal(0)
  return totalFiado.minus(totalPagos)
}
