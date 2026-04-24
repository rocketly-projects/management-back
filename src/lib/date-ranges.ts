/**
 * Parsea un string YYYY-MM-DD como medianoche UTC.
 * Evita que el timezone local del servidor desplace la fecha.
 */
export function parseFechaUTC(fechaStr: string): Date {
  const [y, m, d] = fechaStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Inicio (00:00:00.000) y fin (23:59:59.999) del día en UTC. */
export function getRangoDia(fecha: Date): { desde: Date; hasta: Date } {
  const desde = new Date(fecha)
  desde.setUTCHours(0, 0, 0, 0)
  const hasta = new Date(fecha)
  hasta.setUTCHours(23, 59, 59, 999)
  return { desde, hasta }
}

/** Rango completo del día anterior al dado. */
export function getRangoAyer(hoy: Date): { desde: Date; hasta: Date } {
  const ayer = new Date(hoy)
  ayer.setUTCDate(ayer.getUTCDate() - 1)
  return getRangoDia(ayer)
}

/** Rango de los últimos 7 días terminando en fechaFin (inclusive). */
export function getUltimos7Dias(fechaFin: Date): { desde: Date; hasta: Date } {
  const desde = new Date(fechaFin)
  desde.setUTCDate(desde.getUTCDate() - 6)
  desde.setUTCHours(0, 0, 0, 0)
  const hasta = new Date(fechaFin)
  hasta.setUTCHours(23, 59, 59, 999)
  return { desde, hasta }
}
