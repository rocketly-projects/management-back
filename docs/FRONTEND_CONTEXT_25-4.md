# Frontend Context — Rocketly POS
**Fecha:** 2026-04-25
**Stack:** Next.js (App Router), TypeScript, Tailwind CSS, Zustand

---

## 1. Arquitectura general

```
app/
  (auth)/
    login/          → Pantalla de login
    onboarding/     → Registro de nueva cuenta (5 pasos)
  (app)/
    dashboard/      → Panel principal con KPIs y gráficos
    caja/           → POS: cobrar ventas
    ventas/         → Historial y análisis de ventas
    cierre-caja/    → Cierre de turno con reporte
    productos/      → ABM de catálogo
lib/
  api/              → Funciones fetch por dominio
  hooks/            → Hooks React que consumen la API
  store/            → Estado global (Zustand)
  types/            → Interfaces TypeScript que espeja el schema Prisma
```

---

## 2. Cliente HTTP

- **Base URL:** `process.env.NEXT_PUBLIC_API_URL` (default: `http://localhost:3001`)
- **Auth:** `Authorization: Bearer <token>` en cada request
- El token se lee de `localStorage` bajo la key `auth-store` (Zustand persist)
- Al recibir **401** → limpia el store y redirige a `/login`
- Los errores no-2xx parsean `body.message ?? body.error` como mensaje
- **204 No Content** retorna `undefined` sin intentar parsear JSON

```ts
// Estructura de error esperada en respuestas de error:
{
  message: string,
  fields?: Record<string, string[]>   // errores de validación por campo (opcional)
}
```

---

## 3. Autenticación

### Flujo de sesión
1. Login / Register → backend devuelve `{ token, perfil }`
2. El frontend guarda `token` en `localStorage` (Zustand persist) y en una cookie `auth-token` (para el middleware de Next.js)
3. El middleware de Next.js lee `auth-token` para proteger rutas `/dashboard`, `/caja`, etc.
4. Logout → borra cookie y store, redirige a `/login`

### POST /auth/login
```ts
// Request body
{ email: string; password: string }

// Response
{ token: string; perfil: Perfil }
```

### POST /auth/register
```ts
// Request body
{
  email:         string;   // requerido
  password:      string;   // requerido
  nombreNegocio: string;   // requerido
  nombreDueno?:  string;
  telefono?:     string;
  direccion?:    string;   // string libre: "Calle 123, Ciudad, Provincia, CP, País"
  taxId?:        string;
}

// Response — igual que /auth/login
{ token: string; perfil: Perfil }
```

> El onboarding recolecta dirección, horarios y rubro durante el flujo pero **los horarios y el rubro no se envían al backend todavía** (no existe endpoint para eso). Solo se envían los campos del `RegisterPayload` de arriba.

---

## 4. Tipos principales

```ts
type EstadoCaja  = "ABIERTA" | "CERRADA"
type MetodoPago  = "EFECTIVO" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "TRANSFERENCIA" | "OTRO"
type EstadoVenta = "COMPLETADA" | "ANULADA"

interface Perfil {
  id:            string
  tenantId:      string
  nombreNegocio: string
  nombreDueno:   string
  telefono:      string | null
  direccion:     string | null
  taxId:         string | null
  moneda:        string          // default "ARS"
  logo:          string | null
}

interface Producto {
  id:         string
  tenantId:   string
  sku:        string | null
  nombre:     string
  marca:      string | null
  precio:     number
  costo:      number | null
  stock:      number
  stockAlert: number | null
  categoria:  string | null
  imagen:     string | null
  activo:     boolean
  createdAt:  string
  updatedAt:  string
}

interface Venta {
  id:         string
  tenantId:   string
  numero:     number
  total:      number
  descuento:  number
  metodoPago: MetodoPago
  estado:     EstadoVenta
  cajaId:     string
  createdAt:  string
  items?:     ItemVenta[]
}

interface ItemVenta {
  id:             string
  ventaId:        string
  productoId:     string
  cantidad:       number
  precioUnitario: number
  subtotal:       number
  producto?:      { nombre: string; sku: string | null }
}

interface Caja {
  id:            string
  tenantId:      string
  montoInicial:  number
  montoCierre:   number | null
  apertura:      string   // ISO datetime
  cierre:        string | null
  estado:        EstadoCaja
  notas:         string | null
}

interface Gasto {
  id:          string
  cajaId:      string
  descripcion: string
  monto:       number
  createdAt:   string
}

interface PaginatedResponse<T> {
  data:  T[]
  total: number
  page:  number
  limit: number
}
```

---

## 5. Endpoints consumidos

### Perfil

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/perfil` | Obtiene el perfil del tenant autenticado |
| PUT | `/perfil` | Actualiza campos del perfil (Partial\<Perfil\>) |

---

### Productos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/productos` | Lista productos. Query params: `categoria`, `activo` (boolean), `busqueda` |
| GET | `/productos/:id` | Obtiene un producto por id |
| POST | `/productos` | Crea producto |
| PUT | `/productos/:id` | Actualiza producto |
| DELETE | `/productos/:id` | Elimina producto (respuesta 204) |

**Body create/update:** `Partial<Producto>` (sin `id`, `tenantId`, `createdAt`, `updatedAt`)

---

### Ventas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ventas` | Lista paginada. Query params: `page`, `limit`, `estado`, `cajaId`, `desde` (ISO), `hasta` (ISO) |
| GET | `/ventas/:id` | Venta con `items` incluidos |
| POST | `/ventas` | Crea venta |
| POST | `/ventas/:id/anular` | Anula venta (respuesta: `Venta` con estado ANULADA) |

**POST /ventas — body:**
```ts
{
  items:      { productoId: string; cantidad: number }[]
  descuento?: number   // monto fijo en pesos
  metodoPago: MetodoPago
  cajaId:     string
}
```

**GET /ventas — respuesta:**
```ts
PaginatedResponse<Venta>
// { data: Venta[], total: number, page: number, limit: number }
```

---

### Caja

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/caja/activa` | Devuelve la caja abierta o `null` |
| POST | `/caja/abrir` | Abre una nueva caja |
| POST | `/caja/cerrar` | Cierra la caja activa |
| GET | `/caja/:cajaId/gastos` | Lista gastos de una caja |
| POST | `/caja/:cajaId/gastos` | Registra un gasto |

**POST /caja/abrir — body:** `{ montoInicial: number }`
**POST /caja/cerrar — body:** `{ montoCierre: number; notas?: string }`
**POST /caja/:cajaId/gastos — body:** `{ descripcion: string; monto: number }`

---

### Reportes

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/reportes/dashboard` | KPIs del día. Query param: `fecha` (YYYY-MM-DD, default hoy) |
| GET | `/reportes/cierre-caja/:cajaId` | Reporte completo de una caja |
| GET | `/reportes/comparativo-semanal` | Totales diarios de los últimos 7 días. Query param: `fechaFin` (YYYY-MM-DD) |
| GET | `/reportes/ventas-agregadas` | Ventas agrupadas. Query params: `desde` (ISO), `hasta` (ISO), `agrupar` (`hora`/`dia`/`metodo`), `estado` (opcional) |

**GET /reportes/dashboard — respuesta esperada:**
```ts
{
  hoy: {
    totalFact:     number
    cantVentas:    number
    ticketPromedio: number
    anuladasCount: number
    totalAnulado:  number
  }
  ayer: {
    totalFact:     number
    cantVentas:    number
    ticketPromedio: number
    anuladasCount: number
  }
  ventasPorHora: { hora: number; total: number; cantidad: number }[]
  topProductos:  { productoId: string; nombre: string; unidades: number; total: number }[]
}
```

> **IMPORTANTE:** Para cuentas nuevas sin ventas, el backend debe devolver este objeto con valores en cero, no `null` ni campos ausentes. El frontend normaliza defensivamente pero lo ideal es que el backend siempre devuelva la estructura completa.

**GET /reportes/cierre-caja/:cajaId — respuesta esperada:**
```ts
{
  totales: {
    totalFact:     number
    cantVentas:    number
    ticketPromedio: number
    anuladasCount: number
    totalAnulado:  number
  }
  porMetodo: { metodoPago: MetodoPago; total: number; cantidad: number }[]
  topProductos: { productoId: string; nombre: string; unidades: number; total: number }[]
  comparativoSemanal: {
    dias:        { fecha: string; total: number }[]
    totalSemana: number
    promedio:    number
  }
}
```

**GET /reportes/ventas-agregadas — respuestas según `agrupar`:**
```ts
// agrupar=hora
{ hora: number; total: number; cantidad: number }[]

// agrupar=dia
{ fecha: string; total: number; cantidad: number }[]

// agrupar=metodo
{ metodoPago: MetodoPago; total: number; cantidad: number; porcentaje: number }[]
```

---

## 6. Páginas y su comportamiento

### /login
- Formulario email + password
- POST /auth/login → guarda `{ token, perfil }` → redirige a `/dashboard`

### /onboarding (5 pasos)
1. **Datos del comercio** — nombre, nombre del dueño, rubro (UI only), CUIT, teléfono
2. **Datos de acceso** — email, contraseña (min 8 chars), confirmar contraseña
3. **Dirección** — calle, ciudad, provincia, CP, país (UI only, se concatena en `direccion`)
4. **Horarios** — días y franjas horarias (UI only, no se envía al backend)
5. **Confirmar** — resumen editable antes de crear

Al confirmar: POST /auth/register → guarda sesión → muestra pantalla de éxito → link a `/dashboard`

> Los pasos 3 (dirección) y 4 (horarios) son recolectados para UX pero el backend solo recibe los campos de `RegisterPayload`. La dirección se concatena como string libre.

### /dashboard
- Llama GET /reportes/dashboard?fecha=YYYY-MM-DD
- Llama GET /caja/activa (estado de la caja en el header)
- Muestra KPIs: ventas del día, cantidad, ticket promedio, anulaciones
- Gráfico de barras por franja horaria (horas 7–20)
- Top productos del día
- Alertas de stock bajo (calculadas client-side desde el store de productos)

### /caja (POS)
- Al entrar: verifica si hay caja activa (GET /caja/activa)
- Si no hay caja: pide monto inicial → POST /caja/abrir
- Catálogo de productos con búsqueda y filtro por categoría
- Carrito con soporte de cantidad, descuento (% o monto fijo), cambio para efectivo
- Al cobrar: POST /ventas con `{ items, descuento, metodoPago, cajaId }`
- Atajos de teclado: F1–F5 para método de pago, Enter para cobrar, Escape para cancelar

### /ventas
- Filtros de fecha: hoy / ayer / semana (7d) / mes (30d)
- GET /ventas con `desde`, `hasta`, paginación de 20 por página
- GET /reportes/ventas-agregadas con `agrupar=hora` para heatmap
- GET /reportes/ventas-agregadas con `agrupar=metodo` para distribución por método
- Detalle de venta en drawer lateral: GET /ventas/:id (incluye items con nombre de producto)
- Anular venta: POST /ventas/:id/anular

### /cierre-caja
- Requiere caja activa (si no hay, redirige a /caja)
- GET /reportes/cierre-caja/:cajaId para mostrar el resumen del turno
- Permite ingresar el efectivo contado y calcula la diferencia vs. lo esperado
- POST /caja/cerrar → redirige a /dashboard

### /productos
- GET /productos (lista completa, sin paginación actualmente)
- Filtros client-side: categoría, activo/inactivo, búsqueda por nombre/SKU
- Drawer para crear/editar: POST /productos o PUT /productos/:id
- Toggle activo/inactivo: PUT /productos/:id con `{ activo: boolean }`
- Eliminar: DELETE /productos/:id

---

## 7. Estado global (Zustand)

### authStore (persistido en localStorage como `auth-store`)
```ts
{ token: string | null; perfil: Perfil | null; isAuthenticated: boolean }
```
- También escribe cookie `auth-token` para el middleware de Next.js

### cajaStore (en memoria, no persistido)
```ts
{ cajaActiva: Caja | null; loading: boolean }
```
- Se hidrata llamando `fetchActiva()` en el layout de `(app)`

### productosStore (en memoria, no persistido)
```ts
{ productos: Producto[] }
```
- Se carga bajo demanda. El dashboard lo carga si está vacío para calcular alertas de stock.

---

## 8. Comportamiento de sesión / auth

- Las rutas bajo `(app)/` están protegidas por middleware de Next.js que verifica la cookie `auth-token`
- Si el token expira, cualquier request con 401 limpia el estado y redirige a `/login` automáticamente
- El token viaja siempre como `Authorization: Bearer <token>`

---

## 9. Notas y comportamientos especiales

- **MetodoPago "OTRO"** se muestra en la UI como "Mercado Pago"
- **Descuento en ventas** es un monto fijo en pesos; el frontend calcula el `total` final antes de enviarlo al backend
- **Stock:** el frontend descuenta stock optimísticamente en el carrito (validación de stock > 0 antes de agregar), pero confía en que el backend valide y devuelva error si no hay stock suficiente
- **Número de venta:** el campo `numero` de `Venta` se usa para mostrar `#0001`, `#0002`, etc. Se espera que el backend lo autoincrement por tenant
- **Paginación de ventas:** el frontend usa `page` (base 1) y `limit=20`. La respuesta debe incluir `total` para calcular si hay más páginas
- **Fechas:** el frontend envía fechas en formato ISO 8601 full (`2026-04-25T00:00:00.000Z`) para filtros de ventas, y en formato `YYYY-MM-DD` para el endpoint de reportes/dashboard
