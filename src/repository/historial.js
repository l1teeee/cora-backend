import { query } from '../db.js'

export async function guardarSnapshot({ assistantId, config, usuario }) {
  const sql = 'INSERT INTO historial_asistente (assistant_id, config_json, usuario) VALUES (?, ?, ?)'
  const result = await query(sql, [assistantId, JSON.stringify(config), usuario])

  return { id: result.insertId }
}

function enteroPositivo(valor, porDefecto) {
  const entero = Math.trunc(Number(valor))
  return Number.isFinite(entero) && entero >= 1 ? entero : porDefecto
}

export async function listarSnapshots({ assistantId, page = 1, limit = 20 } = {}) {
  const paginaSanitizada = enteroPositivo(page, 1)
  const limiteSanitizado = Math.min(100, enteroPositivo(limit, 20))
  const offset = (paginaSanitizada - 1) * limiteSanitizado

  const condicion = assistantId ? 'WHERE assistant_id = ?' : ''
  const params = assistantId ? [assistantId] : []

  // Nunca config_json en el listado: cada snapshot pesa ~35KB y 20 en una pagina serian ~700KB
  // de respuesta. CHAR_LENGTH da una idea del tamano sin traer el contenido completo.
  // mysql2 no admite placeholders en LIMIT/OFFSET con prepared statements; van interpolados como enteros ya validados
  const sql = `
    SELECT id, assistant_id, usuario, fecha, CHAR_LENGTH(config_json) AS tamano
    FROM historial_asistente
    ${condicion}
    ORDER BY fecha DESC, id DESC
    LIMIT ${limiteSanitizado} OFFSET ${offset}
  `

  const data = await query(sql, params)
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM historial_asistente ${condicion}`, params)

  return {
    data,
    paginacion: {
      page: paginaSanitizada,
      limit: limiteSanitizado,
      total,
      totalPages: Math.ceil(total / limiteSanitizado)
    }
  }
}

export async function obtenerSnapshot(id) {
  const filas = await query('SELECT * FROM historial_asistente WHERE id = ?', [id])
  const fila = filas[0]

  if (!fila) return null

  // mysql2 devuelve la columna JSON ya parseada como objeto en versiones recientes, pero como
  // string en otras configuraciones: se normaliza siempre a objeto antes de devolverla
  const configJson = typeof fila.config_json === 'string' ? JSON.parse(fila.config_json) : fila.config_json

  return { ...fila, config_json: configJson }
}
