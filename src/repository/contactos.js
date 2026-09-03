import { query } from '../db.js'

function enteroPositivo(valor, porDefecto) {
  const entero = Math.trunc(Number(valor))
  return Number.isFinite(entero) && entero >= 1 ? entero : porDefecto
}

// Un telefono vacio no identifica a nadie: agruparlos crearia un contacto basura con el
// conteo de todas las llamadas anonimas.
export async function upsertDesdeLlamada({ telefono, nombre, fecha }) {
  if (typeof telefono !== 'string' || telefono.trim() === '') return null

  // nombre = COALESCE(nombre, VALUES(nombre)): un nombre mal entendido en una llamada posterior
  // no debe pisar el que ya estaba. Las fechas se envuelven en COALESCE por ambos lados porque
  // LEAST/GREATEST con un NULL devuelven NULL y borrarian la fecha ya guardada.
  const sql = `
    INSERT INTO contactos (telefono, nombre, primera_llamada, ultima_llamada, total_llamadas)
    VALUES (?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      nombre = COALESCE(nombre, VALUES(nombre)),
      primera_llamada = LEAST(COALESCE(primera_llamada, VALUES(primera_llamada)), COALESCE(VALUES(primera_llamada), primera_llamada)),
      ultima_llamada = GREATEST(COALESCE(ultima_llamada, VALUES(ultima_llamada)), COALESCE(VALUES(ultima_llamada), ultima_llamada)),
      total_llamadas = total_llamadas + 1
  `

  const result = await query(sql, [telefono.trim().slice(0, 32), nombre ?? null, fecha ?? null, fecha ?? null])

  return { telefono, insertado: result.affectedRows === 1 }
}

export async function listarContactos({ page = 1, limit = 20, q } = {}) {
  const paginaSanitizada = enteroPositivo(page, 1)
  const limiteSanitizado = Math.min(100, enteroPositivo(limit, 20))
  const offset = (paginaSanitizada - 1) * limiteSanitizado

  const busqueda = typeof q === 'string' && q.trim() !== '' ? `%${q.trim()}%` : null
  const condicion = busqueda ? 'WHERE telefono LIKE ? OR nombre LIKE ?' : ''
  const params = busqueda ? [busqueda, busqueda] : []

  // mysql2 no admite placeholders en LIMIT/OFFSET con prepared statements; van interpolados como enteros ya validados
  const sql = `
    SELECT id, telefono, nombre, notas, primera_llamada, ultima_llamada, total_llamadas, created_at, updated_at
    FROM contactos
    ${condicion}
    ORDER BY ultima_llamada DESC, id DESC
    LIMIT ${limiteSanitizado} OFFSET ${offset}
  `

  const data = await query(sql, params)
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM contactos ${condicion}`, params)

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

export async function obtenerContacto(telefono) {
  const filas = await query('SELECT * FROM contactos WHERE telefono = ?', [telefono])
  return filas[0] ?? null
}

// Sin la columna transcripcion a proposito: es LONGTEXT y aqui se devuelven hasta 50 filas
export async function llamadasDelContacto(telefono, { limit = 50 } = {}) {
  const limiteSanitizado = Math.min(200, enteroPositivo(limit, 50))

  const sql = `
    SELECT id, call_id, fecha, duracion, costo, resumen, razon_finalizacion, numero_telefono,
           url_grabacion, usuario_asignado, nombre_capturado, motivo, requiere_seguimiento, created_at
    FROM llamadas
    WHERE numero_telefono = ?
    ORDER BY fecha DESC, id DESC
    LIMIT ${limiteSanitizado}
  `

  return await query(sql, [telefono])
}

export async function actualizarContacto(telefono, { nombre, notas } = {}) {
  const asignaciones = []
  const params = []

  if (nombre !== undefined) {
    asignaciones.push('nombre = ?')
    params.push(nombre)
  }

  if (notas !== undefined) {
    asignaciones.push('notas = ?')
    params.push(notas)
  }

  if (asignaciones.length === 0) return false

  params.push(telefono)
  const result = await query(`UPDATE contactos SET ${asignaciones.join(', ')} WHERE telefono = ?`, params)

  return result.affectedRows > 0
}
