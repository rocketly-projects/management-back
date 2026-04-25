# Backend Summary — management-back

> Generado: 2026-04-25
> Rama: `main` | Deploy: Vercel (serverless)

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Hono v4 (`@hono/node-server`) |
| ORM | Prisma v5 |
| Base de datos | PostgreSQL (Supabase, con pgbouncer) |
| Auth | JWT via `jose` + `bcryptjs` |
| Validación | Zod + `@hono/zod-validator` |
| Deploy | Vercel serverless |

---

## Base URL

- **Local:** `http://localhost:3001`
- **CORS:** acepta requests desde `FRONTEND_URL` (env var). Default: `http://localhost:3000`
- **Headers permitidos:** `Authorization`, `Content-Type`
- **Métodos:** `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

---

## Autenticación

Todas las rutas salvo `/auth/*` y `GET /health` requieren:

```
Authorization: Bearer <token>
```

El token es un JWT firmado con `JWT_SECRET`. Contiene `{ tenantId, email }`.

Todo el backend es **multi-tenant estricto**: cada recurso se filtra por `tenantId` extraído del token. No se puede acceder a datos de otro negocio.

---

## Manejo de errores

Todos los errores devuelven JSON:

```json
{ "error": "mensaje descriptivo" }
```

En desarrollo, los 500 también incluyen `details` con el mensaje de la excepción.

| Status | Cuándo |
|---|---|
| `400` | Validación de negocio (caja cerrada, stock insuficiente, descuento > total) |
| `401` | Token ausente, malformado o inválido |
| `404` | Recurso no existe o no pertenece al tenant |
| `409` | Conflicto de unicidad (email duplicado en registro, unicidad de Prisma P2002) |
| `422` | Error de validación de esquema Zod |
| `500` | Error interno |

---

## Rutas públicas

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-04-25T12:00:00.000Z" }
```

---

### `POST /auth/register`

Crea un nuevo tenant con su perfil inicial en una transacción atómica.

**Body:**
```json
{
  "email":         "string — email válido, requerido",
  "password":      "string — mín. 8 caracteres, requerido",
  "nombreNegocio": "string — requerido",
  "nombreDueno":   "string — opcional"
}
```

**Respuesta 201:**
```json
{
  "token": "string (JWT)",
  "tenant": {
    "id":       "cuid",
    "email":    "string",
    "nombre":   "string",
    "slug":     "string",
    "plan":     "BASIC | PRO | ENTERPRISE",
    "activo":   true,
    "creadoEn": "ISO 8601"
  }
}
```

> **Diferencia con front:** el front espera `{ token, perfil }` pero el back devuelve `{ token, tenant }`.
> El front deberá llamar a `GET /perfil` por separado si necesita el objeto `Perfil` completo, o ajustar los tipos.

**Errores:** `409` si el email ya existe.

---

### `POST /auth/login`

**Body:**
```json
{
  "email":    "string",
  "password": "string"
}
```

**Respuesta 200:**
```json
{
  "token": "string (JWT)",
  "tenant": { /* mismo objeto que register */ }
}
```

> Misma diferencia: devuelve `tenant`, no `perfil`.

**Errores:** `401` con mensaje genérico (no revela si falló email o password).

---

## Rutas protegidas

> Todas requieren `Authorization: Bearer <token>`

---

## Perfil — `/perfil`

### `GET /perfil`

```json
{
  "id":            "cuid",
  "tenantId":      "cuid",
  "nombreNegocio": "string",
  "nombreDueno":   "string | null",
  "telefono":      "string | null",
  "direccion":     "string | null",
  "taxId":         "string | null",
  "moneda":        "ARS",
  "logo":          "string (URL) | null",
  "creadoEn":      "ISO 8601"
}
```

> Nota de campo: el back usa `creadoEn`, no `createdAt`.

### `PUT /perfil`

Todos los campos son opcionales (patch semántico).

**Body:**
```json
{
  "nombreNegocio": "string",
  "nombreDueno":   "string",
  "telefono":      "string",
  "direccion":     "string",
  "taxId":         "string",
  "moneda":        "string (3 letras, ej: ARS, USD)",
  "logo":          "URL string"
}
```

**Respuesta 200:** perfil actualizado.

---

## Configuracion — `/configuracion`

### `GET /configuracion`

Si no existe, la crea con defaults (idempotente).

```json
{
  "id":          "cuid",
  "tenantId":    "cuid",
  "tema":        "DARK | LIGHT",
  "accentColor": "#2563eb"
}
```

### `PUT /configuracion`

```json
{
  "tema":        "LIGHT | DARK",
  "accentColor": "#rrggbb — hex 6 dígitos"
}
```

**Respuesta 200:** configuración actualizada. Crea el registro si no existía.

---

## Productos — `/productos`

### `GET /productos`

**Query params (todos opcionales):**

| Param | Tipo | Descripción |
|---|---|---|
| `categoria` | string | Filtra por categoría exacta |
| `activo` | `"true"` \| `"false"` | Default: solo activos (`"true"`) |
| `busqueda` | string | Busca en `nombre` y `sku` (case-insensitive, contains) |

**Respuesta 200:** array (sin paginación).

```json
[
  {
    "id":            "cuid",
    "tenantId":      "cuid",
    "sku":           "string | null",
    "nombre":        "string",
    "marca":         "string | null",
    "precio":        100.00,
    "costo":         60.00,
    "stock":         10,
    "stockAlert":    5,
    "categoria":     "string | null",
    "imagen":        "URL | null",
    "activo":        true,
    "creadoEn":      "ISO 8601",
    "actualizadoEn": "ISO 8601"
  }
]
```

> `precio` y `costo` son `number` (el back convierte Decimal de Prisma).
> **Diferencia con front:** el back usa `creadoEn` / `actualizadoEn`, el front espera `createdAt` / `updatedAt`.

### `GET /productos/:id`

Devuelve el producto sin importar si está activo o inactivo (para permitir reactivación).
**Errores:** `404`.

### `POST /productos`

```json
{
  "nombre":     "string — requerido",
  "precio":     100.00,
  "sku":        "string — opcional",
  "marca":      "string — opcional",
  "costo":      60.00,
  "stock":      0,
  "stockAlert": 5,
  "categoria":  "string — opcional",
  "imagen":     "URL — opcional",
  "activo":     true
}
```

**Respuesta 201:** producto completo.

### `PUT /productos/:id`

Mismos campos que POST, todos opcionales. **Respuesta 200.**

### `DELETE /productos/:id`

**Soft delete** — setea `activo = false`, no elimina el registro.

**Respuesta 200:**
```json
{ "message": "Producto desactivado" }
```

> **Diferencia con front:** el front espera `204 No Content`. El back devuelve `200` con body JSON.

---

## Caja — `/caja`

Flujo: `abrir` → registrar ventas → opcionalmente registrar gastos → `cerrar`.
Solo puede haber **una caja abierta por tenant** a la vez.

### `GET /caja/activa`

Devuelve la caja abierta o `null`.

```json
{
  "id":           "cuid",
  "tenantId":     "cuid",
  "apertura":     "ISO 8601",
  "cierre":       null,
  "montoInicial": 1000.00,
  "montoCierre":  null,
  "notas":        null,
  "estado":       "ABIERTA"
}
```

### `POST /caja/abrir`

```json
{ "montoInicial": 1000.00 }
```

**Respuesta 201:** objeto caja.
**Errores:** `400` si ya hay una caja abierta (body: `{ "error": "...", "cajaId": "string" }`).

### `POST /caja/cerrar`

```json
{
  "montoCierre": 5200.00,
  "notas":       "string — opcional"
}
```

**Respuesta 200:** objeto caja con `estado: "CERRADA"` y `cierre` timestamp.
**Errores:** `400` si no hay caja abierta.

### `GET /caja/:id/gastos`

Lista gastos de la caja ordenados por `creadoEn` ASC.

```json
[
  {
    "id":          "cuid",
    "cajaId":      "cuid",
    "descripcion": "string",
    "monto":       150.00,
    "creadoEn":    "ISO 8601"
  }
]
```

> **Diferencia con front:** el back usa `creadoEn`, el front espera `createdAt`.

### `POST /caja/:id/gastos`

La caja debe estar **ABIERTA**.

```json
{
  "descripcion": "string — requerido",
  "monto":       150.00
}
```

**Respuesta 201:** gasto creado.
**Errores:** `404` (caja no encontrada), `400` (caja cerrada).

---

## Ventas — `/ventas`

### `GET /ventas`

**Query params:**

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `page` | number | 1 | Página (base 1) |
| `limit` | number | 20 | Items por página (máx. 100) |
| `estado` | `COMPLETADA \| ANULADA \| PENDIENTE` | — | Filtro |
| `cajaId` | string | — | Filtro por caja |
| `desde` | ISO 8601 datetime | — | Ej: `2026-04-25T00:00:00.000Z` |
| `hasta` | ISO 8601 datetime | — | Ej: `2026-04-25T23:59:59.999Z` |

**Respuesta 200:**

```json
{
  "data": [
    {
      "id":         "cuid",
      "tenantId":   "cuid",
      "cajaId":     "cuid",
      "numero":     1,
      "total":      500.00,
      "descuento":  0.00,
      "metodoPago": "EFECTIVO",
      "estado":     "COMPLETADA",
      "creadoEn":   "ISO 8601"
    }
  ],
  "pagination": {
    "page":  1,
    "limit": 20,
    "total": 42,
    "pages": 3
  }
}
```

> **Diferencias con front:**
> - El back devuelve `pagination: { page, limit, total, pages }` anidado; el front espera `{ data, total, page, limit }` flat.
> - El listado **no incluye items**. Usar `GET /ventas/:id` para ver el detalle.
> - El back usa `creadoEn`, el front espera `createdAt`.

### `GET /ventas/:id`

Venta completa con items y datos de producto.

```json
{
  "id":         "cuid",
  "tenantId":   "cuid",
  "cajaId":     "cuid",
  "numero":     1,
  "total":      500.00,
  "descuento":  0.00,
  "metodoPago": "EFECTIVO",
  "estado":     "COMPLETADA",
  "creadoEn":   "ISO 8601",
  "items": [
    {
      "id":             "cuid",
      "ventaId":        "cuid",
      "productoId":     "cuid",
      "cantidad":       2,
      "precioUnitario": 250.00,
      "subtotal":       500.00,
      "producto": {
        "id":     "cuid",
        "nombre": "string",
        "sku":    "string | null"
      }
    }
  ]
}
```

### `POST /ventas`

Operación atómica. El back:
1. Verifica caja abierta del tenant (automático, no se necesita enviar `cajaId`)
2. Carga productos y valida que existan, estén activos y pertenezcan al tenant
3. Valida stock suficiente
4. Calcula totales server-side (precio tomado del DB, no del cliente)
5. Valida descuento ≤ subtotal
6. Genera `numero` autoincremental por tenant
7. Crea `Venta` + `ItemVenta` en un solo create anidado
8. Decrementa stock de cada producto

**Body:**
```json
{
  "items": [
    { "productoId": "cuid", "cantidad": 2 }
  ],
  "descuento":  0,
  "metodoPago": "EFECTIVO | DEBITO | CREDITO | TRANSFERENCIA | MERCADO_PAGO"
}
```

> **Diferencias con front:**
> - El front envía `cajaId` en el body — el back lo **ignora y lo resuelve internamente**. No rompe, pero es innecesario.
> - Los métodos de pago del back son: `EFECTIVO`, `DEBITO`, `CREDITO`, `TRANSFERENCIA`, `MERCADO_PAGO`.
>   El front usa: `EFECTIVO`, `TARJETA_DEBITO`, `TARJETA_CREDITO`, `TRANSFERENCIA`, `OTRO`. **Este es un desajuste crítico.**

**Respuesta 201:** venta completa con items (igual que `GET /ventas/:id`).

**Errores:**

| Status | Causa |
|---|---|
| `400` | No hay caja abierta |
| `400` | Stock insuficiente (mensaje indica producto y cantidades) |
| `400` | Descuento mayor al subtotal |
| `404` | Producto no encontrado o inactivo |
| `422` | Items duplicados en la misma venta |

### `POST /ventas/:id/anular`

Sin body. Anula una venta `COMPLETADA` y restaura el stock.

**Respuesta 200:** venta con `estado: "ANULADA"`.
**Errores:** `404` (no existe), `400` (ya anulada u otro estado).

---

## Reportes — `/reportes`

### `GET /reportes/dashboard`

KPIs del día vs ayer, desglose por hora, top 5 productos.

**Query params:**

| Param | Tipo | Default |
|---|---|---|
| `fecha` | `YYYY-MM-DD` | hoy (UTC) |

**Respuesta 200 (estructura real del back):**

```json
{
  "fecha": "2026-04-25",
  "kpis": {
    "totalFacturado":    { "valor": 15000.00, "deltaVsAyer": 12.5 },
    "cantidadVentas":   { "valor": 42,        "deltaVsAyer": -5.0 },
    "ticketPromedio":   { "valor": 357.14,    "deltaVsAyer": null },
    "productosVendidos":{ "valor": 130,       "deltaVsAyer": 8.3  }
  },
  "ventasPorHora": [
    { "hora": 9, "total": 1200.00, "cantidad": 4 }
  ],
  "topProductos": [
    { "productoId": "cuid", "nombre": "string", "cantidad": 20, "total": 5000.00 }
  ]
}
```

> `deltaVsAyer` es `null` cuando no hubo ventas ayer (no hay base para comparar). Es un porcentaje con 1 decimal.
> `ventasPorHora` solo incluye las horas con ventas (array puede estar vacío).
> **Diferencia con front:** el front espera un shape completamente distinto con `hoy`, `ayer`, `anuladasCount`, etc. Hay que alinear.

---

### `GET /reportes/comparativo-semanal`

Últimos 7 días con totales por día. Los días sin ventas se incluyen con `total: 0`.

**Query params:**

| Param | Tipo | Default |
|---|---|---|
| `fechaFin` | `YYYY-MM-DD` | hoy (UTC) |

**Respuesta 200:**

```json
{
  "dias": [
    { "fecha": "2026-04-19", "diaSemana": "Dom", "total": 0.00, "cantidadVentas": 0 },
    { "fecha": "2026-04-20", "diaSemana": "Lun", "total": 3200.00, "cantidadVentas": 12 }
  ],
  "promedio":     2100.00,
  "totalSemana":  14700.00
}
```

> `diaSemana` es: `"Dom" | "Lun" | "Mar" | "Mié" | "Jue" | "Vie" | "Sáb"`.
> El campo por ítem es `cantidadVentas` (no `cantidad`).

---

### `GET /reportes/cierre-caja/:cajaId`

Reporte completo de una caja (funciona con cajas abiertas o cerradas).

**Respuesta 200 (estructura real del back):**

```json
{
  "caja": {
    "id":           "cuid",
    "apertura":     "ISO 8601",
    "montoInicial": 1000.00,
    "estado":       "CERRADA",
    "cierre":       "ISO 8601 | null",
    "montoCierre":  5200.00
  },
  "totales": {
    "totalFacturado":    4200.00,
    "cantidadVentas":    18,
    "ticketPromedio":    233.33,
    "productosVendidos": 52
  },
  "desglosePagos": [
    { "metodo": "EFECTIVO", "monto": 2500.00, "cantidad": 10, "porcentaje": 59.52 }
  ],
  "topProductos": [
    { "productoId": "cuid", "nombre": "string", "cantidad": 15, "total": 1800.00 }
  ],
  "comparativoSemanal": [
    { "fecha": "2026-04-19", "diaSemana": "Dom", "total": 0.00, "cantidadVentas": 0 }
  ],
  "gastos": {
    "total":    300.00,
    "cantidad": 2
  }
}
```

> **Diferencias con front:** el front espera `porMetodo` (array), `anuladasCount`, `totalAnulado`, y el comparativo anidado diferente. El back no devuelve datos de anulaciones en este endpoint. Hay que alinear.

**Errores:** `404` si la caja no existe.

---

### `GET /reportes/ventas-agregadas`

Agregación flexible para gráficos.

**Query params:**

| Param | Tipo | Req. | Descripción |
|---|---|---|---|
| `desde` | `YYYY-MM-DD` | si | Inicio del rango |
| `hasta` | `YYYY-MM-DD` | si | Fin del rango |
| `agrupar` | `hora \| dia \| metodo` | si | Modo de agrupación |
| `estado` | `COMPLETADA \| ANULADA \| PENDIENTE` | no | Default: `COMPLETADA` |

Validaciones: `desde` ≤ `hasta`. Rango máximo: 366 días.

**Respuesta — `agrupar=dia`:**
```json
{
  "agrupacion": "dia",
  "data": [
    { "fecha": "2026-04-20", "total": 3200.00, "cantidad": 12 }
  ]
}
```

**Respuesta — `agrupar=metodo`:**
```json
{
  "agrupacion": "metodo",
  "data": [
    { "metodoPago": "EFECTIVO", "total": 8000.00, "cantidad": 30, "porcentaje": 54.05 }
  ]
}
```

**Respuesta — `agrupar=hora`** (heatmap día × hora):
```json
{
  "agrupacion": "hora",
  "data": [
    { "diaSemana": 1, "hora": 10, "total": 1200.00, "cantidad": 5 }
  ]
}
```

> En modo `hora`, `diaSemana` es número: `0=Dom, 1=Lun, ..., 6=Sáb`.
> La respuesta está **envuelta** en `{ agrupacion, data }`. El front debe desempaquetar `.data`.

---

## Enums

```
Plan:         BASIC | PRO | ENTERPRISE
MetodoPago:   EFECTIVO | DEBITO | CREDITO | TRANSFERENCIA | MERCADO_PAGO
EstadoVenta:  COMPLETADA | ANULADA | PENDIENTE
EstadoCaja:   ABIERTA | CERRADA
Tema:         LIGHT | DARK
```

---

## Modelos de datos (Prisma Schema)

### Tenant
```
id, email (unique), passwordHash, nombre, slug (unique), plan, activo, creadoEn
```

### Perfil (1-1 con Tenant)
```
id, tenantId (unique), nombreNegocio, nombreDueno?, telefono?, direccion?,
taxId?, moneda (default "ARS"), logo?, creadoEn
```

### Configuracion (1-1 con Tenant)
```
id, tenantId (unique), tema (default DARK), accentColor (default "#2563eb")
```

### Producto
```
id, tenantId, sku?, nombre, marca?, precio (Decimal), costo? (Decimal),
stock (Int), stockAlert (default 5), categoria?, imagen?, activo (default true),
creadoEn, actualizadoEn
```

### Venta
```
id, tenantId, cajaId, numero (Int — autoincremental por tenant), total (Decimal),
descuento (Decimal, default 0), metodoPago, estado (default COMPLETADA), creadoEn
```
Constraint único: `(tenantId, numero)`.

### ItemVenta
```
id, ventaId, productoId, cantidad (Int), precioUnitario (Decimal), subtotal (Decimal)
```

### Caja
```
id, tenantId, apertura (default now), cierre?, montoInicial (Decimal),
montoCierre? (Decimal), notas?, estado (default ABIERTA)
```

### Gasto
```
id, cajaId, descripcion, monto (Decimal), creadoEn
```

---

## Resumen de diferencias back vs front (para alinear)

| # | Punto | Back (real) | Front (espera) | Acción sugerida |
|---|---|---|---|---|
| 1 | Login/Register response | `{ token, tenant }` | `{ token, perfil }` | Front adapta tipos o back agrega perfil |
| 2 | Nombres de fechas en Producto | `creadoEn`, `actualizadoEn` | `createdAt`, `updatedAt` | Alinear en uno (recomendado: camelCase en español) |
| 3 | Nombres de fechas en Gasto | `creadoEn` | `createdAt` | Idem |
| 4 | `DELETE /productos/:id` | `200` + JSON | `204` No Content | Ajustar el cliente HTTP del front |
| 5 | Paginación de ventas | `{ data, pagination: { page, limit, total, pages } }` | `{ data, total, page, limit }` (flat) | Alinear shape |
| 6 | `MetodoPago` enum | `DEBITO`, `CREDITO`, `MERCADO_PAGO` | `TARJETA_DEBITO`, `TARJETA_CREDITO`, `OTRO` | **Crítico** — alinear enum |
| 7 | `POST /ventas` body | No necesita `cajaId` | Envía `cajaId` | El back lo ignora; no rompe |
| 8 | Dashboard response shape | `{ fecha, kpis, ventasPorHora, topProductos }` | Shape completamente diferente | Requiere alineación |
| 9 | Cierre caja response shape | `{ caja, totales, desglosePagos, ... }` | `{ totales, porMetodo, ... }` | Requiere alineación |
| 10 | Ventas-agregadas response | Envuelto en `{ agrupacion, data }` | Array directo | Front desempaqueta `.data` |
