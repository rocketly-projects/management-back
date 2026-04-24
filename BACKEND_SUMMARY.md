# Estado actual del backend — management-back

## Stack
- **Runtime:** Node.js + Hono (framework HTTP minimalista, edge-compatible)
- **ORM:** Prisma 5.22.0 + PostgreSQL (Supabase)
- **Auth:** JWT propio con `jose` (HS256, 7 días), passwords con `bcryptjs` (salt 12)
- **Validación:** Zod + helper `zv()` / `zvQuery()` — errores 422 con detalle de campos
- **Deploy objetivo:** Vercel (serverless Node.js)
- **TypeScript:** strict mode

---

## Multi-tenancy
Cada tenant es un negocio independiente. Toda query a la base lleva `tenantId` en el `where`. No hay datos compartidos entre tenants.

---

## Base de datos — modelos

| Modelo | Descripción |
|--------|-------------|
| `Tenant` | Cuenta principal: email, passwordHash, nombre, slug, plan |
| `Perfil` | Datos del negocio: nombreNegocio, nombreDueno, telefono, direccion, taxId, moneda, logo |
| `Configuracion` | UI preferences: tema (LIGHT/DARK), accentColor (hex) |
| `Producto` | SKU, nombre, marca, precio, costo, stock, stockAlert, categoria, imagen, activo |
| `Venta` | numero (autoincremental por tenant), total, descuento, metodoPago, estado, cajaId |
| `ItemVenta` | productoId, cantidad, precioUnitario (snapshot histórico), subtotal |
| `Caja` | montoInicial, montoCierre, apertura, cierre, estado (ABIERTA/CERRADA) |
| `Gasto` | descripcion, monto, cajaId |

---

## Endpoints disponibles

### Públicos
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servidor |
| POST | `/auth/register` | Crea tenant + perfil en transacción. Retorna JWT |
| POST | `/auth/login` | Valida credenciales. Retorna JWT. Error genérico (no revela qué falló) |

### Protegidos (requieren `Authorization: Bearer <token>`)

**Productos**
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/productos` | Lista con filtros: `categoria`, `activo`, `busqueda` |
| GET | `/productos/:id` | Detalle |
| POST | `/productos` | Crear |
| PUT | `/productos/:id` | Actualizar |
| DELETE | `/productos/:id` | Soft delete (`activo = false`) |

**Caja**
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/caja/activa` | Caja abierta del tenant o `null` |
| POST | `/caja/abrir` | Abre caja con `montoInicial`. 400 si ya hay una abierta |
| POST | `/caja/cerrar` | Cierra caja con `montoCierre` y `notas?` |
| GET | `/caja/:id/gastos` | Lista gastos de una caja |
| POST | `/caja/:id/gastos` | Registra gasto en caja abierta |

**Ventas**
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/ventas` | Listado paginado. Filtros: `page`, `limit`, `estado`, `cajaId`, `desde`, `hasta` (ISO 8601) |
| GET | `/ventas/:id` | Detalle con items y datos del producto |
| POST | `/ventas` | Crea venta en transacción atómica (ver detalle abajo) |
| POST | `/ventas/:id/anular` | Anula venta y restaura stock en transacción |

**Perfil**
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/perfil` | Datos del perfil del tenant |
| PUT | `/perfil` | Actualiza nombreNegocio, nombreDueno, telefono, direccion, taxId, moneda, logo |

**Configuracion**
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/configuracion` | Configuración del tenant (crea con defaults si no existe) |
| PUT | `/configuracion` | Actualiza tema (LIGHT/DARK) y accentColor (hex) |

---

## Lógica crítica

**Crear venta** — todo dentro de una sola transacción Prisma:
1. Verifica que haya caja abierta
2. Carga productos validando que sean del tenant y estén activos
3. Valida stock suficiente por item
4. Calcula subtotales y total **server-side** (precio snapshot del DB, nunca del cliente)
5. Valida que descuento ≤ subtotal
6. Genera número autoincremental por tenant (evita race conditions)
7. Crea `Venta` + `ItemVenta` anidados
8. Decrementa stock de cada producto

**Filtros de fecha en GET /ventas** — params opcionales `desde` y `hasta` en formato ISO 8601 (ej. `2026-04-24T00:00:00.000Z`). Filtran por `creadoEn` con `gte` / `lte`. Combinables con `estado`, `cajaId`, `page` y `limit`. Formato inválido devuelve 422.

**Anular venta** — transacción:
1. Verifica que la venta sea del tenant y esté en estado `COMPLETADA`
2. Restaura stock de cada item
3. Cambia estado a `ANULADA`

---

## Lo que NO está implementado (fuera de scope del MVP)

- Reportes / dashboard (ventas por período, productos más vendidos, resumen de caja)
- Historial de cajas cerradas con totales
- Alertas de stock bajo (`stockAlert`)
- Rate limiting en auth
- Refresh tokens (el JWT expira en 7 días sin renovación)
- Roles / permisos dentro de un mismo tenant
- Upload real de imágenes (logo y producto aceptan URL, no archivo)

---

## Variables de entorno necesarias

```
DATABASE_URL    # Supabase pooler puerto 6543 con ?pgbouncer=true
DIRECT_URL      # Supabase direct puerto 5432 (para migraciones)
JWT_SECRET      # Mínimo 32 caracteres
FRONTEND_URL    # Para CORS (ej. http://localhost:5173)
NODE_ENV        # production | development
```
