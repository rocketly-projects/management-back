/**
 * Smoke test — Tanda 6: Ventas
 * Requiere servidor corriendo en localhost:3000.
 *
 * Flujo:
 *  1. Register → obtiene token
 *  2. Crear producto A (stock 10)
 *  3. Crear producto B (stock 5)
 *  4. Abrir caja
 *  5. POST /ventas → venta de A(2) + B(1) con descuento
 *  6. GET /ventas → aparece en el listado
 *  7. GET /ventas/:id → detalle con items
 *  8. Verificar stock decrementado en productos
 *  9. POST /ventas/:id/anular → estado ANULADA
 * 10. Verificar stock restaurado
 * 11. Intentar anular nuevamente → 400
 * 12. Intentar venta sin caja abierta → cerrar caja primero → 400
 */

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.error(`  ❌ ${label}`)
    failed++
  }
}

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Tanda 6: Ventas ─────────────────────────────────────────────')

// 1. Register
console.log('\n[1] Auth')
const email = `ventas-test-${Date.now()}@test.com`
const { status: rs, data: rd } = await req('POST', '/auth/register', {
  email,
  password: 'password123',
  nombreNegocio: 'Test Ventas',
})
assert(rs === 201 && rd.token, 'Register → 201 + token')
const token = rd.token

// 2. Crear producto A
console.log('\n[2] Productos')
const { status: paS, data: paD } = await req('POST', '/productos', {
  nombre: 'Coca Cola 500ml',
  precio: 1500,
  stock: 10,
}, token)
assert(paS === 201, 'Crear producto A → 201')
const productoA = paD

const { status: pbS, data: pbD } = await req('POST', '/productos', {
  nombre: 'Agua Mineral',
  precio: 800,
  stock: 5,
}, token)
assert(pbS === 201, 'Crear producto B → 201')
const productoB = pbD

// 3. Abrir caja
console.log('\n[3] Caja')
const { status: cajaS, data: cajaD } = await req('POST', '/caja/abrir', { montoInicial: 5000 }, token)
assert(cajaS === 201, 'Abrir caja → 201')
const cajaId = cajaD.id

// 4. POST /ventas
console.log('\n[4] Crear venta')
const { status: vs, data: vd } = await req('POST', '/ventas', {
  items: [
    { productoId: productoA.id, cantidad: 2 },
    { productoId: productoB.id, cantidad: 1 },
  ],
  descuento: 200,
  metodoPago: 'EFECTIVO',
}, token)
assert(vs === 201, 'POST /ventas → 201')
assert(vd.estado === 'COMPLETADA', 'Estado COMPLETADA')
// subtotal = 1500*2 + 800*1 = 3800 — descuento 200 = 3600
assert(vd.total === 3600, `Total correcto (esperado 3600, recibido ${vd.total})`)
assert(vd.items?.length === 2, 'Items: 2')
assert(vd.numero === 1, `Número autoincremental = 1 (recibido ${vd.numero})`)
assert(vd.cajaId === cajaId, 'Venta ligada a la caja abierta')
const ventaId = vd.id

// 5. GET /ventas
console.log('\n[5] Listado')
const { status: ls, data: ld } = await req('GET', '/ventas', null, token)
assert(ls === 200, 'GET /ventas → 200')
assert(Array.isArray(ld.data), 'Respuesta tiene data[]')
assert(ld.pagination?.total === 1, 'Total en paginación = 1')

// 6. GET /ventas/:id
console.log('\n[6] Detalle')
const { status: ds, data: dd } = await req('GET', `/ventas/${ventaId}`, null, token)
assert(ds === 200, 'GET /ventas/:id → 200')
assert(dd.items?.length === 2, 'Items incluidos')
assert(dd.items?.[0]?.producto?.nombre !== undefined, 'Item tiene producto.nombre')

// 7. Verificar stock decrementado
console.log('\n[7] Stock decrementado')
const { data: stockA } = await req('GET', `/productos/${productoA.id}`, null, token)
const { data: stockB } = await req('GET', `/productos/${productoB.id}`, null, token)
assert(stockA.stock === 8, `Stock A: esperado 8, recibido ${stockA.stock}`)
assert(stockB.stock === 4, `Stock B: esperado 4, recibido ${stockB.stock}`)

// 8. Anular venta
console.log('\n[8] Anular')
const { status: as, data: ad } = await req('POST', `/ventas/${ventaId}/anular`, null, token)
assert(as === 200, 'POST /ventas/:id/anular → 200')
assert(ad.estado === 'ANULADA', 'Estado ANULADA')

// 9. Verificar stock restaurado
console.log('\n[9] Stock restaurado')
const { data: restA } = await req('GET', `/productos/${productoA.id}`, null, token)
const { data: restB } = await req('GET', `/productos/${productoB.id}`, null, token)
assert(restA.stock === 10, `Stock A restaurado: esperado 10, recibido ${restA.stock}`)
assert(restB.stock === 5, `Stock B restaurado: esperado 5, recibido ${restB.stock}`)

// 10. Intentar anular nuevamente → 400
console.log('\n[10] Re-anular rechazado')
const { status: ras } = await req('POST', `/ventas/${ventaId}/anular`, null, token)
assert(ras === 400, 'Re-anular → 400')

// 11. Validaciones de negocio
console.log('\n[11] Validaciones')

// Productos duplicados
const { status: dupS } = await req('POST', '/ventas', {
  items: [
    { productoId: productoA.id, cantidad: 1 },
    { productoId: productoA.id, cantidad: 1 },
  ],
  metodoPago: 'EFECTIVO',
}, token)
assert(dupS === 422, 'Items duplicados → 422')

// Stock insuficiente (A tiene 10, pedimos 999)
const { status: stockS } = await req('POST', '/ventas', {
  items: [{ productoId: productoA.id, cantidad: 999 }],
  metodoPago: 'EFECTIVO',
}, token)
assert(stockS === 400, 'Stock insuficiente → 400')

// Descuento > subtotal
const { status: dscS } = await req('POST', '/ventas', {
  items: [{ productoId: productoA.id, cantidad: 1 }],
  descuento: 99999,
  metodoPago: 'EFECTIVO',
}, token)
assert(dscS === 400, 'Descuento > subtotal → 400')

// 12. Venta sin caja abierta
console.log('\n[12] Sin caja abierta')
// Cerrar la caja
await req('POST', '/caja/cerrar', { montoCierre: 5000 }, token)
const { status: noCajaS } = await req('POST', '/ventas', {
  items: [{ productoId: productoA.id, cantidad: 1 }],
  metodoPago: 'EFECTIVO',
}, token)
assert(noCajaS === 400, 'Venta sin caja abierta → 400')

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n── Resultado: ${passed} passed, ${failed} failed ─────────────────────\n`)
if (failed > 0) process.exit(1)
