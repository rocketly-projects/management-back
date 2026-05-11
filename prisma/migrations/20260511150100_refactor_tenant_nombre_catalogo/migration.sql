-- Refactor: Tenant.nombre como identificador único del catálogo público
-- 1. Agregar nombreDisplay (copia del nombre actual, legible para UI)
-- 2. Hacer nombre único (deduplicar datos de dev agregando el id como sufijo)
-- 3. Eliminar Perfil.nombreNegocio (el nombre del negocio ahora vive en Tenant.nombre/nombreDisplay)

-- Paso 1: Agregar columna nombreDisplay copiando el nombre actual (idempotente)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "nombreDisplay" TEXT;
UPDATE "Tenant" SET "nombreDisplay" = "nombre" WHERE "nombreDisplay" IS NULL;

-- Paso 2: Deduplicar "nombre" en datos existentes antes de agregar unique constraint
UPDATE "Tenant" t
SET "nombre" = t."nombre" || SUBSTRING(t."id", 1, 6)
WHERE t."id" NOT IN (
  SELECT DISTINCT ON ("nombre") "id"
  FROM "Tenant"
  ORDER BY "nombre", "creadoEn" ASC
);

-- Paso 3: Agregar unique constraint a nombre (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Tenant_nombre_key' AND conrelid = '"Tenant"'::regclass
  ) THEN
    ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_nombre_key" UNIQUE ("nombre");
  END IF;
END $$;

-- Paso 4: Eliminar nombreNegocio de Perfil (idempotente)
ALTER TABLE "Perfil" DROP COLUMN IF EXISTS "nombreNegocio";
