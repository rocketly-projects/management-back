# Fiscalidad y ARCA — Roadmap y documentación de referencia

> Documentación duradera del proyecto. **Leer antes de tomar cualquier decisión técnica relacionada a facturación, comprobantes fiscales, o impresoras térmicas fiscales.**
>
> Última revisión: mayo 2026. La normativa de ARCA (ex AFIP) cambia con frecuencia — al consultar montos, alícuotas o resoluciones, verificar la fuente oficial vigente.

---

## 1. Contexto: qué es ARCA y qué cambió

**ARCA = Agencia de Recaudación y Control Aduanero**, organismo que reemplazó a AFIP en 2024 (Decreto 953/2024). Funcionalmente equivalente para la mayoría de los efectos: misma clave fiscal, mismos web services, mismas obligaciones. Lo que sí cambió es el branding y algunas URLs (`*.arca.gob.ar` reemplaza a `*.afip.gob.ar` en producción, aunque las URLs viejas siguen redirigiendo).

**Implicancias para Rocketly:**
- Toda referencia a "AFIP" en docs o código es válida pero puede actualizarse a "ARCA".
- Los web services siguen funcionando con los mismos certificados y endpoints históricos.
- AfipSDK mantiene el nombre histórico pero opera sobre ARCA.

---

## 2. Tipos de contribuyente en Argentina

Cada tenant del SaaS tendrá uno de estos tipos. Define qué tipo de comprobante puede emitir y qué obligaciones tiene.

### 2.1 Monotributista (Régimen Simplificado)
- **Comprobante único:** Factura C (mercado interno) y Factura E (exportación). Sin discriminar IVA en ningún caso.
- **Cliente:** indistinto. Se emite la misma Factura C a un consumidor final, a otro monotributista, o a un Responsable Inscripto.
- **Categorías:** A (la más baja, hasta ~$10.277.988/año en 2026) hasta K (la más alta). La categoría F que tiene el kiosco piloto es categoría media-baja, suficiente para un kiosco de pueblo.
- **Obligación:** emitir factura electrónica por **toda** operación. No hay umbral mínimo.
- **Identificación del cliente:** solo obligatoria cuando la operación es de $10.000.000 o más (RG 5700/2025, vigente desde 29-mayo-2025). Por debajo: "consumidor final" sin datos alcanza.
- **Tope para usar el "Facturador" simplificado de ARCA:** $500.000 por operación. Operaciones mayores requieren otro método (comprobantes en línea o sistema propio vía web service).

### 2.2 Responsable Inscripto en IVA (RI)
- **Comprobantes múltiples:**
  - **Factura A** → a otros RI. Discrimina IVA (alícuotas 21% / 10.5% / 27% / 0%). El comprador puede tomar crédito fiscal.
  - **Factura B** → a consumidores finales, monotributistas, exentos. NO discrimina IVA (lo incluye en el precio, pero no lo separa visualmente más allá de leyenda).
  - **Factura M** → la usa un RI nuevo o con perfil de riesgo asignado por ARCA. Funcionalmente igual a la A pero activa régimen de retención de IVA y Ganancias en cabeza del comprador. Con buen historial fiscal se puede solicitar el pase a A.
  - **Factura E** → exportación.
- **Obligación de IVA:** declaración mensual, pago de saldo técnico (débito - crédito fiscal).
- **Controlador fiscal:** para ciertas actividades de alto volumen y venta presencial (kioscos, supermercados, gastronomía), ARCA puede exigir un **controlador fiscal de nueva tecnología** homologado en lugar de factura electrónica web. Ver sección 5.

### 2.3 Exento
- Asociaciones civiles, fundaciones, ciertos profesionales exentos.
- Comprobante: Factura C / Recibo C.
- Comportamiento similar a monotributista a efectos de comprobantes.

---

## 3. Tipos de comprobantes — referencia rápida

| Comprobante | Emisor | Receptor | Discrimina IVA | Tope identificación cliente |
|-------------|--------|----------|----------------|------------------------------|
| Factura A   | RI     | RI       | Sí             | Siempre identificar (CUIT obligatorio) |
| Factura B   | RI     | Consumidor final / Monotributista / Exento | No (incluido) | $10M (RG 5700/2025) |
| Factura C   | Monotributista / Exento | Cualquiera | No | $10M (RG 5700/2025) |
| Factura M   | RI con perfil de riesgo | RI | Sí | Siempre identificar |
| Factura E   | Cualquiera | Exterior | No | Identificación obligatoria |

**Nota:** Notas de crédito y débito siguen el mismo tipo que la factura original (NC-A, NC-B, NC-C, ND-A, etc.) y referencian el CAE de la factura original.

---

## 4. Decisiones tomadas para Rocketly (mayo 2026)

### 4.1 Para el kiosco piloto (tenant Monotributista F)
**Decisión:** no implementar facturación electrónica ahora.

**Justificación:**
- El kiosco lleva 25 años operando sin emitir Factura C. El contador opera con historial de Mercado Pago, lo cual no es una factura legalmente pero documenta los ingresos.
- Técnicamente esto incumple la obligación de emitir factura electrónica por toda operación (consecuencias potenciales: exclusión del régimen, clausura 2-6 días, multas $250.000-$2.500.000 según Ley 27799 actualizada).
- En la práctica, ARCA hace control selectivo. Kioscos chicos de pueblo no son objetivo prioritario. El riesgo latente es el cruce automático entre datos de MP y facturación declarada — si esto se detecta, llega un requerimiento.
- Cambiar el modelo del cliente es decisión del cliente y su contador, no del proveedor de POS.

**Acción concreta:** el schema de la DB contempla `Factura` y los enums fiscales desde el inicio (ver sección 11), pero no hay endpoints de emisión. Si el tenant piloto decide regularizar, ahí se activa la lógica.

### 4.2 Sobre la impresora térmica
**Decisión:** mantener implementación de impresora térmica común (ESC/POS), no comprar controlador fiscal.

**Justificación:**
- La Hasar P-HAS-181 que está integrada vía `@node-escpos/*` es una impresora térmica de tickets, **NO** un controlador fiscal homologado por ARCA.
- Emite tickets de venta no fiscales, comandas, X y Z internos. Útil para control operativo del kiosco.
- Para emitir Factura C/B con validez fiscal por impresora se necesita un **controlador fiscal de nueva tecnología** homologado (hardware distinto, técnico habilitado del proveedor para el alta, alta del equipo en ARCA, configuración específica).
- Para el caso actual (monotributista que no factura), la impresora común alcanza y sobra. El PDF + WhatsApp tiene más valor inmediato para el comprobante al cliente.

### 4.3 Modelo de datos preparado para el futuro
**Decisión:** diseñar el modelo `Factura` y los enums de `Perfil`/`Cliente` desde ya, aunque solo se implemente lógica de emisión cuando un tenant concreto lo necesite.

**Justificación:**
- Refactorizar un modelo de facturación cuando ya hay producción duele mucho más que diseñarlo bien al principio.
- Tiempo de diseño ahora: ~1 sesión de planning. Tiempo de refactor después: semanas.
- La migración inicial no rompe nada porque los campos nuevos tienen defaults razonables.

---

## 5. Casos de uso futuros — qué hacer cuando aparezcan

### 5.1 Primer tenant que pide impresora térmica conectada

**Qué pide el cliente:** "Quiero imprimir un ticket en papel térmico cuando termino una venta, igual que en los supermercados."

**Qué NO pide (importante aclarar con el cliente):** "Quiero emitir Factura C en papel térmico con validez fiscal." Esto requiere otro hardware.

**Acciones:**
1. Confirmar con el tenant que entiende la diferencia: ticket interno (lo que ofrecemos) vs comprobante fiscal (lo que NO ofrecemos sin integración con ARCA).
2. Recomendar impresora compatible con ESC/POS de red. Modelos económicos: Xprinter XP-T80A, Epson TM-T20III. La Hasar P-HAS-181 también es compatible.
3. Guiarlo en el alta: conectar al router, obtener IP (botón de autotest), asignar IP fija en el router por MAC.
4. En la configuración del tenant, ingresar IP + puerto 9100 (default ESC/POS de red).
5. Probar emisión desde el modal de ticket post-venta.

**Si el tenant sí quiere emitir Factura C en papel térmico:** redirigir a un controlador fiscal homologado. Esto está fuera del alcance actual de Rocketly. Marcas habituales: Hasar SMH/PR4, Epson TM-T900FA, NCR, Bematech. Implica integración con SDK propietario del fabricante, no con ESC/POS.

### 5.2 Primer tenant Responsable Inscripto que pide facturar

**Contexto importante:** cuando hablamos de "primer tenant RI", nos referimos a un **futuro cliente de Rocketly** (un negocio que nos compre el SaaS) que sea Responsable Inscripto. No se refiere a los clientes (compradores) del negocio piloto. Ver sección 11 para vocabulario.

**Qué pide el tenant:** "Soy RI, mis clientes son empresas y consumidores finales, necesito emitir Factura A y B con CAE."

**Acciones — orden recomendado:**

1. **Validar la información fiscal del tenant:**
   - CUIT del tenant
   - Confirmar que tiene clave fiscal nivel 3 en ARCA
   - Confirmar que tiene punto de venta dado de alta para web service (NO el mismo que use para comprobantes en línea web)
   - Confirmar condición ante IIBB (jurisdicción / Convenio Multilateral)

2. **Generar certificado digital:**
   - El tenant, con su clave fiscal, debe ingresar a "Administración de Certificados Digitales" en ARCA.
   - Generar Certificate Signing Request (CSR) con el CUIT.
   - Subir el CSR a ARCA → ARCA devuelve el certificado (.crt o .pem).
   - Guardar la clave privada (.key) — esta es secreta, el tenant debe entregárnosla o configurarla él mismo en el sistema.
   - **Importante:** hay certificado de homologación (testing) y de producción. Son distintos. Empezar por homologación.

3. **Asociar el certificado al web service que se va a usar:**
   - "Administrador de Relaciones de Clave Fiscal" → autorizar el certificado a operar con WSFE (Factura Electrónica) y WSFEv1.

4. **Decidir la vía de integración (sección 6).**

5. **Implementar el flujo:**
   - Endpoint `POST /facturas/:ventaId` que: lee la venta, calcula importes/IVA según items, determina tipo (A/B según condición del receptor), solicita CAE a ARCA, guarda en `Factura`, devuelve datos para PDF + QR.
   - Generar QR según especificación ARCA (RG 4892/2020): URL base + payload base64 con los datos del comprobante.
   - Visor de factura con CAE + QR + opción de PDF.

6. **Plan de testing en homologación:**
   - Emitir al menos 10 comprobantes en homologación cubriendo: Factura A, Factura B, Nota de Crédito A, distintas alícuotas de IVA, cliente con CUIT y sin CUIT (B), monto bajo y monto sobre $10M.
   - Validar CAE devuelto y formato del QR.
   - Recién después pasar a producción cambiando endpoints y certificado.

### 5.3 Primer tenant RI con alto volumen presencial (kiosco/super/gastronomía)

**Particularidad:** algunas actividades de venta presencial están obligadas a usar **controlador fiscal de nueva tecnología** en lugar de factura electrónica web. Esto depende de la actividad declarada en AFIP/ARCA y del volumen.

**Acciones:**
- Consultar con el contador del tenant si su actividad está obligada a controlador fiscal.
- Si está obligado: Rocketly hoy NO emite a controlador fiscal directamente. Sería una integración nueva (SDK propietario por marca).
- Alternativa actual: el sistema lleva la gestión interna y los comprobantes los emite el controlador fiscal por separado. No es ideal, pero es viable como solución transitoria.

---

## 6. AfipSDK vs WSAA+WSFE directo

Cuando llegue el momento de integrar facturación electrónica, hay tres caminos.

### 6.1 AfipSDK (afipsdk.com)

**Qué hace:** abstrae toda la complejidad SOAP/certificados/Ticket de Acceso. La API es REST, los SDKs cubren Node.js, PHP, Python, Ruby, .NET, etc.

**Pricing actualizado (mayo 2026):**
| Plan    | Precio       | CUITs | Requests/mes | Notas |
|---------|--------------|-------|--------------|-------|
| Free    | USD 0        | 1     | 1.000        | Para probar |
| Pro     | USD 25/mes   | 10    | 10.000       | Soporta primeros tenants |
| Growth  | USD 80/mes   | 100   | 100.000      | Para SaaS en crecimiento |
| Startup | USD 250/mes  | 1.000 | 1.000.000    | Post product-market fit |

Pay-as-you-go disponible para excedentes.

**Importante para SaaS multi-tenant:** cada CUIT cuenta separado. Para Rocketly esto significa que el plan Free solo cubre 1 tenant RI real. A partir del segundo tenant RI hay que pasar a Pro mínimo. Esto debe modelarse en el pricing del producto desde el inicio.

**Pros:**
- Implementación en días, no semanas.
- Maneja automáticamente: renovación de Ticket de Acceso (caduca cada 12hs), parsing SOAP, errores específicos de ARCA.
- Soporte por email/Discord.

**Contras:**
- Costo recurrente que escala con cantidad de tenants.
- Dependencia de un tercero (si AfipSDK tiene downtime, los tenants no facturan).

### 6.2 WSAA + WSFE directo (vía SOAP)

**Qué implica:**
- Implementar el protocolo WSAA: armar XML de login, firmarlo con CMS usando el certificado, llamar al endpoint, parsear el TA (Token + Sign).
- Implementar WSFE/WSFEv1: armar el request SOAP de FECAESolicitar, parsear respuesta, manejar errores.
- Manejar caducidad del TA (12hs), regenerar cuando expira.
- Mantener un set de WSDLs (homologación y producción).
- Sin libs argentinas mantenidas activamente en Node.js — la opción más estable es generar todo a mano o usar un wrapper genérico SOAP (`strong-soap`, `node-soap`).

**Pros:**
- Gratis, sin límites, sin dependencia de terceros.
- Control total sobre el flujo.

**Contras:**
- 2-3 semanas de trabajo dedicado mínimo para un dev sin experiencia previa con SOAP/AFIP.
- Mantenimiento propio cuando ARCA cambia algo (sucede a veces sin aviso).
- Manejo de errores SOAP es engorroso.

### 6.3 Librerías open-source (alternativa intermedia)

Hay wrappers de la comunidad que abstraen WSAA+WSFE sin ser comerciales:
- **PyAfipWs** (Python, Mariano Reingart): el más histórico y completo. GPLv3.
- **afipsdk/afip.js** (no oficial, GitHub público): wrapper Node.js sobre los web services.
- Wrappers en PHP, Ruby, Java mantenidos por la comunidad.

**Pros:**
- Gratis y sin límites.
- Maneja la complejidad SOAP.

**Contras:**
- Mantenimiento depende del autor — algunas librerías quedaron sin updates por años.
- Soporte = issues en GitHub.

### 6.4 Recomendación

**Etapa 1 — primer tenant RI:** AfipSDK plan Free para validar el flujo de punta a punta sin invertir tiempo en SOAP. Una vez validado, evaluar.

**Etapa 2 — entre 2 y 10 tenants RI:** AfipSDK plan Pro (USD 25/mes). El costo es marginal.

**Etapa 3 — más de 10 tenants RI:** evaluar AfipSDK Growth (USD 80/mes) vs invertir en integración directa. La integración directa se justifica si:
- Hay capacidad interna para mantenerla.
- El volumen de requests está acercándose al tope del plan.
- Se quiere eliminar la dependencia de un tercero.

---

## 7. Datos requeridos para emitir cada tipo de factura

### Factura C (monotributista o exento)
- CUIT del emisor (del Perfil)
- Punto de venta
- Tipo de concepto (productos / servicios / mixto)
- Fecha de emisión
- Importe total
- Condición del receptor (consumidor final si no se especifica)
- Datos del receptor solo si la operación es ≥ $10.000.000

### Factura A (RI a RI)
- Todo lo de C
- **+** CUIT del receptor (obligatorio siempre)
- **+** Discriminación de IVA por alícuota:
  - Base imponible al 21%
  - Importe de IVA al 21%
  - (Idem para 10.5%, 27%, 0% si aplica)
- **+** Importes no gravados / exentos si aplica
- **+** Condición del receptor: RESPONSABLE_INSCRIPTO

### Factura B (RI a consumidor final / monotributista)
- Todo lo de A, pero el IVA va incluido en el precio (no se discrimina visualmente)
- Datos del receptor solo si la operación es ≥ $10.000.000

---

## 8. QR de validación (RG 4892/2020)

Toda factura electrónica debe tener un QR. Formato:

```
https://www.afip.gob.ar/fe/qr/?p={base64_del_payload}
```

Donde el payload es un JSON con:
```json
{
  "ver": 1,
  "fecha": "2026-05-13",
  "cuit": 20123456789,
  "ptoVta": 1,
  "tipoCmp": 6,
  "nroCmp": 12345,
  "importe": 12100.00,
  "moneda": "PES",
  "ctz": 1,
  "tipoDocRec": 80,
  "nroDocRec": 20987654321,
  "tipoCodAut": "E",
  "codAut": 70123456789012
}
```

(`codAut` = CAE devuelto por ARCA, `tipoCmp` = código numérico del tipo: 1=A, 6=B, 11=C, etc.)

AfipSDK genera el QR automáticamente. Si se va por integración directa, hay que armarlo manualmente.

---

## 9. Fuentes y links útiles

- **ARCA — Monotributo categorías 2026:** https://www.afip.gob.ar/monotributo/categorias.asp
- **ARCA — Web Services (documentación oficial):** https://www.afip.gob.ar/ws/
- **ARCA — Manual de Factura Electrónica WSFEv1:** referenciado desde la página anterior.
- **AfipSDK docs:** https://docs.afipsdk.com
- **AfipSDK pricing:** https://afipsdk.com/pricing
- **PyAfipWs (open source):** https://www.pyafipws.com.ar
- **RG 5700/2025** (umbral $10M para identificar consumidor final): consultable en Boletín Oficial.

---

## 10. Checklist para revisar este documento

Esta documentación debe revisarse cuando:
- [ ] ARCA publica una nueva Resolución General relevante (umbrales, alícuotas, formato de comprobantes).
- [ ] AfipSDK cambia su pricing (revisar https://afipsdk.com/pricing).
- [ ] Aparece el primer tenant Responsable Inscripto en Rocketly.
- [ ] Aparece el primer pedido de impresora térmica fiscal (controlador fiscal homologado).
- [ ] Se decide cambiar la vía de integración (AfipSDK → directo o viceversa).

Última revisión: **mayo 2026** — Juan + Claude.

---

## 11. Vocabulario del proyecto — distinción crítica

Para evitar ambigüedad en este codebase:

| Término | Significado en Rocketly |
|---------|------------------------|
| **Tenant** | El negocio que nos compra el SaaS. Tiene su propio `Perfil`, `Productos`, `Cajas`, `Clientes`. Ejemplo: el kiosco piloto. |
| **Cliente** (modelo DB) | La persona que compra en el negocio del tenant. Para el kiosco son los vecinos del pueblo. En DB es el modelo `Cliente`. |
| **"Primer tenant RI"** | El primer negocio que nos compre Rocketly y sea Responsable Inscripto. No tiene nada que ver con el kiosco piloto. |
| **"Clientes del kiosco"** | Los compradores del negocio piloto. Son `CONSUMIDOR_FINAL` en condición de IVA. |

**El kiosco piloto probablemente nunca use `Factura A/B/M`.** Esos tipos son para futuros tenants RI. El schema los contempla desde ya para no tener que refactorizar cuando aparezca ese tenant.

---

## 12. Estado del schema — mayo 2026 (post-migración `fiscal_models_base`)

### Qué quedó en la DB tras la migración

**Tabla `Perfil`** — campos agregados:
- `tipoContribuyente` → `MONOTRIBUTISTA` por default (todos los tenants existentes adoptan esto automáticamente).
- `categoriaMonotributo` → `null` para el kiosco piloto. **Pendiente**: una pantalla de "Datos fiscales" en el perfil del tenant debe permitir setear este valor (valor esperado para el piloto: `"F"`).
- `puntoVenta` → `null`. Se asigna cuando el tenant se integra con ARCA.
- `ingresosBrutos` → `null`. Número de IIBB o Convenio Multilateral del tenant.
- `fechaInicioActividad` → `null`. Fecha de inicio de actividades declarada en ARCA.

**Tabla `Cliente`** — campos agregados:
- `condicionIva` → `CONSUMIDOR_FINAL` por default (todos los clientes existentes adoptan esto). **Pendiente**: al implementar facturación para un tenant RI, hay que dar UI para clasificar si un cliente es RI, monotributista, etc.
- `cuit` → `null`. Requerido para emitir Factura A. No requerido para B/C salvo montos ≥ $10M.

**Tabla `Factura`** — tabla nueva, vacía. No hay endpoints de emisión todavía. Está preparada para cuando se necesite.

### Qué NO se implementó (decisión consciente)

- Endpoints `POST /facturas/:ventaId` — lógica de emisión.
- Cálculo de IVA por alícuota.
- Integración con AfipSDK o WSFE directo.
- UI de datos fiscales del tenant (pantalla de "Perfil fiscal").
- UI para clasificar `condicionIva` del cliente.
- Backfill manual de los campos fiscales del tenant piloto (categoría F, IIBB, etc.) — queda como tarea manual cuando se haga la pantalla de perfil.

### Cuándo activar la lógica de facturación

- **Para el kiosco piloto:** solo si el dueño decide regularizar y emitir Factura C. Decisión 100% del cliente.
- **Para el primer tenant RI:** cuando aparezca ese cliente de Rocketly. Ver sección 5.2 para el proceso completo.
- **En ambos casos:** la estructura de DB ya está lista. Solo hay que implementar los endpoints y la UI.

---

## 13. Aplicar la migración en producción

La migración `fiscal_models_base` ya fue aplicada a la DB de producción (Supabase `aws-1-sa-east-1.pooler.supabase.com`) el **13 de mayo de 2026**.

Para futuros miembros del equipo o si se configura una DB nueva:

```bash
npx prisma migrate deploy
```

Este comando aplica todas las migraciones pendientes en `prisma/migrations/` de forma no-interactiva. Es el comando correcto para producción (a diferencia de `migrate dev`, que requiere terminal interactiva y está pensado para desarrollo local).
