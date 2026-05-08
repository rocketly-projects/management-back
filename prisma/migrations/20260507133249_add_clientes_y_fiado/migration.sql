-- AlterEnum
ALTER TYPE "MetodoPago" ADD VALUE 'FIADO';

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "clienteId" TEXT;

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagoFiado" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "ventaId" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodoPago" "MetodoPago" NOT NULL,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoFiado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cliente_tenantId_idx" ON "Cliente"("tenantId");

-- CreateIndex
CREATE INDEX "Cliente_tenantId_activo_idx" ON "Cliente"("tenantId", "activo");

-- CreateIndex
CREATE INDEX "Cliente_tenantId_nombre_idx" ON "Cliente"("tenantId", "nombre");

-- CreateIndex
CREATE INDEX "PagoFiado_tenantId_idx" ON "PagoFiado"("tenantId");

-- CreateIndex
CREATE INDEX "PagoFiado_clienteId_idx" ON "PagoFiado"("clienteId");

-- CreateIndex
CREATE INDEX "PagoFiado_ventaId_idx" ON "PagoFiado"("ventaId");

-- CreateIndex
CREATE INDEX "Venta_clienteId_idx" ON "Venta"("clienteId");

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiado" ADD CONSTRAINT "PagoFiado_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiado" ADD CONSTRAINT "PagoFiado_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagoFiado" ADD CONSTRAINT "PagoFiado_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
