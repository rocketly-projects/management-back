# Roadmap — management-back

Backend multi-tenant para un SaaS de gestión de kioscos. Stack: **Hono + Prisma + PostgreSQL (Supabase)**, deploy en **Vercel**. TypeScript estricto, JWT propio con `jose` (edge-compatible), multi-tenancy por `tenantId` en todas las queries.

El desarrollo está partido en **7 tandas** para validar el cableado incrementalmente y no acoplar cambios grandes en un solo commit.

---

## Estado actual

| Tanda | Descripción | Estado |
|-------|-------------|--------|
| 1 | Scaffolding (configs + schema + index mínimo) | Completada |
| 2 | Auth cableado (lib + middleware) | Completada |
| 3 | Rutas de auth (`/auth/register`, `/auth/login`) | Pendiente |
| 4 | Productos (CRUD completo + soft delete) | Pendiente |
| 5 | Caja (apertura, cierre, gastos) | Pendiente |
| 6 | Ventas (transacciones + stock + numeración atómica) | Pendiente |
| 7 | Perfil + Configuración + pulido final | Pendiente |

---

## Estructura del proyecto

```
management-back/
├── src/
│   ├── index.ts              # Hono app, CORS, error handler, /health
│   ├── lib/
│   │   ├── prisma.ts         # PrismaClient singleton
│   │   └── jwt.ts            # sign/verify con jose (HS256, 7d)
│   ├── middleware/
│   │   └── auth.ts           # authMiddleware (Bearer token → contexto)
│   └── routes/
│       ├── auth.ts           # Tanda 3
│       ├── productos.ts      # Tanda 4
│       ├── caja.ts           # Tanda 5
│       ├── ventas.ts         # Tanda 6
│       ├── perfil.ts         # Tanda 7
│       └── configuracion.ts  # Tanda 7
├── prisma/
│   └── schema.prisma         # Multi-tenant schema (Tenant, Producto, Venta, Caja, etc.)
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vercel.json
└── ROADMAP.md
```

---

## Tanda 1 — Scaffolding (Completada)

Dejar el proyecto booteable con `/health` antes de sumar lógica de negocio.

**Archivos creados:**
- `package.json` — deps prod (`hono`, `@hono/zod-validator`, `@hono/node-server`, `@prisma/client`, `zod`, `jose`, `bcryptjs`), devDeps (`prisma`, `typescript`, `tsx`, `@types/bcryptjs`, `@types/node`). Scripts: `dev`, `start`, `build`, `migrate`, `studio`.
- `tsconfig.json` — strict, target ES2020, module ESNext, moduleResolution bundler.
- `vercel.json` — rewrite `/(.*)` → `/src/index.ts`.
- `.env.example` — `DATABASE_URL` (pooler 6543 con `pgbouncer=true`), `DIRECT_URL` (5432), `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV`.
- `.gitignore` — `node_modules`, `.env`, `dist`, `.prisma`, `.vercel`, `*.log`.
- `prisma/schema.prisma` — schema completo multi-tenant (`Tenant`, `Perfil`, `Configuracion`, `Producto`, `Venta`, `ItemVenta`, `Caja`, `Gasto` + enums `Plan`, `MetodoPago`, `EstadoVenta`, `EstadoCaja`, `Tema`).
- `src/index.ts` — Hono app con CORS (allowHeaders `Authorization` + `Content-Type`, origin desde `FRONTEND_URL`), error handler global que retorna `{ error, details? }` y mapea Prisma (`P2002` → 409, `P2025` → 404), `notFound` handler, `GET /health`, arranque local con `@hono/node-server`.

---

## Tanda 2 — Auth cableado (Completada)

Piezas compartidas que consumen las rutas protegidas.

**Archivos creados:**
- `src/lib/prisma.ts` — `PrismaClient` singleton con `globalThis` para evitar múltiples conexiones en hot reloads de dev y en entorno serverless (Vercel).
- `src/lib/jwt.ts` — `signJwt({ tenantId, email })` y `verifyJwt(token)` con jose. Algoritmo HS256, expiración 7 días. Valida que `JWT_SECRET` tenga ≥32 caracteres y que el payload verificado tenga la forma esperada.
- `src/middleware/auth.ts` — `authMiddleware` vía `createMiddleware` de `hono/factory`. Extrae `Authorization: Bearer <token>`, verifica con `verifyJwt`, inyecta `tenantId` y `email` en el contexto de Hono. Retorna **401** si el token falta, es inválido o está expirado.

---

## Tanda 3 — Rutas de auth (Pendiente)

Primer punto de entrada usable del backend: registro y login.

**Archivos a crear:**
- `src/routes/auth.ts`:
  - `POST /auth/register`:
    - Valida body con Zod (`email`, `password`, `nombreNegocio`, `nombreDueno?`).
    - **409** si el email ya está registrado.
    - Hashea el password con `bcryptjs` (salt rounds: 12).
    - Genera `slug` a partir del nombre del negocio (minúsculas, sin espacios, sufijo timestamp para evitar colisiones).
    - Crea `Tenant` + `Perfil` en **una sola transacción** de Prisma.
    - Retorna JWT + datos del tenant (sin `passwordHash`).
  - `POST /auth/login`:
    - Valida body con Zod (`email`, `password`).
    - Mensaje de error **genérico** si el email no existe o el password es incorrecto (no revelar cuál de los dos falló).
    - Retorna JWT + datos del tenant (sin `passwordHash`).

**Modificaciones a archivos existentes:**
- `src/index.ts`: montar `auth.ts` con `app.route('/auth', authRoutes)`. **Sin** `authMiddleware` en este grupo — es público.

---

## Tanda 4 — Productos (Pendiente)

Primer CRUD protegido. Establece el patrón de multi-tenancy + Zod + soft delete que se repite en el resto.

**Archivos a crear:**
- `src/routes/productos.ts`:
  - `GET /productos` — lista productos del tenant. Query params opcionales: `categoria`, `activo`, `busqueda` (busca en `nombre` y `sku`).
  - `GET /productos/:id` — detalle. **404** si el producto no existe o no pertenece al tenant.
  - `POST /productos` — crea producto. Valida con Zod.
  - `PUT /productos/:id` — actualiza producto. Valida con Zod.
  - `DELETE /productos/:id` — **soft delete** (`activo = false`). Nunca delete físico.

**Modificaciones:**
- `src/index.ts`: `app.use('/productos/*', authMiddleware)` antes de `app.route('/productos', productosRoutes)`.

**Regla crítica:** toda query lleva `where: { tenantId, ... }`, sin excepción.

---

## Tanda 5 — Caja (Pendiente)

Gestión de turnos de caja (apertura, cierre, gastos asociados).

**Archivos a crear:**
- `src/routes/caja.ts`:
  - `GET /caja/activa` — caja abierta del tenant, si existe (o `null`).
  - `POST /caja/abrir` — abre nueva caja con `montoInicial`. **400** si ya hay una caja abierta.
  - `POST /caja/cerrar` — cierra caja activa con `montoCierre` y `notas?`. Registra `cierre = new Date()`. **400** si no hay caja abierta.
  - `GET /caja/:id/gastos` — lista gastos de la caja (validando que la caja sea del tenant).
  - `POST /caja/:id/gastos` — registra un gasto en la caja activa.

**Modificaciones:**
- `src/index.ts`: montar con `authMiddleware`.

---

## Tanda 6 — Ventas (Pendiente)

El flujo más crítico del backend — transacciones atómicas, control de stock, numeración secuencial por tenant.

**Archivos a crear:**
- `src/routes/ventas.ts`:
  - `GET /ventas` — listado paginado del tenant.
  - `GET /ventas/:id` — detalle de la venta con sus items.
  - `POST /ventas` — registra venta. Dentro de una **única transacción Prisma**:
    1. Verifica que haya caja abierta (**400** si no).
    2. Verifica que todos los productos existan, sean del tenant y estén activos.
    3. Verifica stock suficiente de cada item (**400** con detalle del producto sin stock).
    4. Guarda `precioUnitario` con el precio **actual** del producto (snapshot histórico, no referencia al producto).
    5. Calcula `subtotal` de cada item y `total` de la venta en el backend (nunca confiar en lo que manda el cliente).
    6. Descuenta `stock` de cada producto.
    7. Genera `numero` autoincremental por tenant dentro de la misma transacción (evita race conditions).
  - `POST /ventas/:id/anular` — cambia estado a `ANULADA`. Solo si estado actual es `COMPLETADA`. **Restaura el stock** de cada producto de los items en transacción.

**Modificaciones:**
- `src/index.ts`: montar con `authMiddleware`.

---

## Tanda 7 — Perfil + Configuración + pulido final (Pendiente)

Rutas simples + revisión integral antes de marcar MVP.

**Archivos a crear:**
- `src/routes/perfil.ts`:
  - `GET /perfil` — perfil del tenant.
  - `PUT /perfil` — actualiza datos del perfil (`nombreNegocio`, `nombreDueno`, `telefono`, `direccion`, `taxId`, `moneda`, `logo`).
- `src/routes/configuracion.ts`:
  - `GET /configuracion` — configuración del tenant.
  - `PUT /configuracion` — actualiza `tema` (`LIGHT` / `DARK`) y `accentColor` (hex).

**Pulido final:**
- Revisar que todas las rutas tengan Zod validator con error **422** + detalle de campos inválidos.
- Audit mental de multi-tenancy: ningún endpoint puede exponer datos de otro tenant, aunque el ID sea correcto.
- Revisar CORS y error handler con todas las rutas integradas.
- Evaluar `export const config = { runtime: 'edge' }` en `src/index.ts` si el deploy en Vercel edge lo requiere (jose fue elegido justamente por ser edge-compatible).
- Smoke test end-to-end: register → login → crear producto → abrir caja → vender → anular venta → verificar stock restaurado.

---

## Reglas globales del proyecto

- **Multi-tenancy:** toda query a Prisma lleva `tenantId` en el `where`. Sin excepciones.
- **Validación:** todo body entrante pasa por Zod antes de tocar la base. Errores de validación → **422** con detalle de campos.
- **Formato de errores:** siempre `{ error: string, details?: any }`. Nunca exponer stack traces en producción.
- **Transacciones:** `prisma.$transaction` obligatorio en:
  - Registro (`Tenant` + `Perfil` en un solo acto).
  - Crear venta (descuento de stock + items + numeración + venta).
  - Anular venta (restauración de stock + cambio de estado).
- **TypeScript:** `strict: true`, sin `any` en el código.
- **No confiar en el cliente:** totales, subtotales, `tenantId`, precios históricos — todo se calcula o extrae en el backend.
- **Seguridad:** login nunca revela si falló email o password; `passwordHash` nunca se retorna en respuestas.

---

## Setup local

```bash
npm install
cp .env.example .env         # completar credenciales reales (ver abajo)
npm run migrate -- --name init
npm run dev                  # http://localhost:3000
curl http://localhost:3000/health
```

### Cómo completar `.env`

Las connection strings las encontrás en **Supabase → Project Settings → Database → Connection string**:

| Variable | Fuente en Supabase | Puerto |
|---|---|---|
| `DATABASE_URL` | Connection pooler (Transaction mode) | 6543 + `?pgbouncer=true` |
| `DIRECT_URL` | Direct connection | 5432 |
| `JWT_SECRET` | Generá uno random: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | — |
| `FRONTEND_URL` | URL del frontend local o en producción | — |

Para que `npm run migrate` funcione, `DIRECT_URL` debe apuntar al puerto **5432**. Para queries en runtime, `DATABASE_URL` usa el pooler en **6543** con `pgbouncer=true`.

### Setup del MCP de Supabase (opcional, por dev)

El MCP permite que Claude Code interactúe directamente con la base de datos (inspeccionar tablas, ejecutar queries, etc.). Es **por máquina** — nunca se committea.

**Requisitos previos:**
- Ser miembro del org de Rocketly en Supabase (pedirle al admin que te invite desde Organization → Team).
- Generar tu propio PAT: **Account → Access Tokens → Generate new token**.

**Configuración (una sola vez por máquina):**
```bash
claude mcp add --scope project --transport http \
  supabase "https://mcp.supabase.com/mcp?project_ref=xehwpexnscnrghzxtnnn" \
  --header "Authorization: Bearer sbp_TU_TOKEN_PERSONAL"
```

**Reglas:**
- Cada dev genera **su propio PAT** — nunca compartir tokens.
- `.mcp.json` está en `.gitignore` — nunca pushear.
- Si rotás el PAT, repetí el comando con el token nuevo (`claude mcp remove supabase` primero).
