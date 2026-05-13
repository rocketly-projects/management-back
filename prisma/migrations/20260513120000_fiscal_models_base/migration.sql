-- CreateEnum
CREATE TYPE "TipoContribuyente" AS ENUM ('MONOTRIBUTISTA', 'RESPONSABLE_INSCRIPTO', 'EXENTO', 'CONSUMIDOR_FINAL');

-- CreateEnum
CREATE TYPE "CondicionIva" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_CATEGORIZADO');

-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'FACTURA_M', 'FACTURA_E', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C', 'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('PENDIENTE', 'EMITIDA', 'RECHAZADA', 'ANULADA');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "condicionIva" "CondicionIva" NOT NULL DEFAULT 'CONSUMIDOR_FINAL',
ADD COLUMN     "cuit" TEXT;

-- AlterTable
ALTER TABLE "Perfil" ADD COLUMN     "categoriaMonotributo" TEXT,
ADD COLUMN     "fechaInicioActividad" TIMESTAMP(3),
ADD COLUMN     "ingresosBrutos" TEXT,
ADD COLUMN     "puntoVenta" INTEGER,
ADD COLUMN     "tipoContribuyente" "TipoContribuyente" NOT NULL DEFAULT 'MONOTRIBUTISTA';

-- CreateTable
CREATE TABLE "Factura" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "tipo" "TipoComprobante" NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "cae" TEXT,
    "vencimientoCae" TIMESTAMP(3),
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importeNeto" DECIMAL(14,2) NOT NULL,
    "importeIva21" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeIva105" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeIva27" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeNoGravado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeExento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(14,2) NOT NULL,
    "condicionIvaReceptor" "CondicionIva" NOT NULL,
    "cuitReceptor" TEXT,
    "nombreReceptor" TEXT,
    "domicilioReceptor" TEXT,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'PENDIENTE',
    "mensajeArca" TEXT,
    "qrUrl" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Factura_ventaId_key" ON "Factura"("ventaId");

-- CreateIndex
CREATE INDEX "Factura_tenantId_fechaEmision_idx" ON "Factura"("tenantId", "fechaEmision");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_tenantId_puntoVenta_tipo_numero_key" ON "Factura"("tenantId", "puntoVenta", "tipo", "numero");

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
