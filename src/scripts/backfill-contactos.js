import '../env.js'
import { query, cerrarPool } from '../db.js'

// Las llamadas anteriores a la tabla `contactos` no pasaron por el webhook que la alimenta.
// Este script las agrega de una sola pasada, en SQL, para no traer miles de filas a memoria.
// Es idempotente: recalcula los agregados desde `llamadas` en vez de sumarlos, asi que
// correrlo dos veces no infla `total_llamadas`.
async function backfill() {
  const resultado = await query(`
    INSERT INTO contactos (telefono, primera_llamada, ultima_llamada, total_llamadas)
    SELECT numero_telefono, MIN(fecha), MAX(fecha), COUNT(*)
    FROM llamadas
    WHERE numero_telefono IS NOT NULL AND numero_telefono <> ''
    GROUP BY numero_telefono
    ON DUPLICATE KEY UPDATE
      primera_llamada = VALUES(primera_llamada),
      ultima_llamada = VALUES(ultima_llamada),
      total_llamadas = VALUES(total_llamadas)
  `)

  // El nombre solo se rellena donde el contacto no tiene uno todavia: el capturado por el
  // asistente en una llamada suelta no debe pisar el que un asesor haya corregido a mano.
  await query(`
    UPDATE contactos c
    JOIN (
      SELECT numero_telefono, MAX(nombre_capturado) AS nombre
      FROM llamadas
      WHERE numero_telefono IS NOT NULL AND nombre_capturado IS NOT NULL
      GROUP BY numero_telefono
    ) l ON l.numero_telefono = c.telefono
    SET c.nombre = l.nombre
    WHERE c.nombre IS NULL
  `)

  const [{ total }] = await query('SELECT COUNT(*) AS total FROM contactos')

  console.log(`Contactos en la tabla: ${total} (filas afectadas: ${resultado.affectedRows})`)
}

try {
  await backfill()
  await cerrarPool()
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
