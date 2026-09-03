import { query } from '../db.js'

export async function guardarLlamada(llamada) {
  const {
    call_id,
    fecha,
    duracion,
    costo,
    transcripcion,
    resumen,
    razon_finalizacion,
    numero_telefono,
    url_grabacion,
    nombre_capturado,
    motivo,
    requiere_seguimiento
  } = llamada

  // COALESCE(VALUES(col), col): el webhook con el analysis llega despues y trae el resto vacio; no debe pisar lo ya guardado
  const sql = `
    INSERT INTO llamadas
      (call_id, fecha, duracion, costo, transcripcion, resumen, razon_finalizacion, numero_telefono, url_grabacion,
       nombre_capturado, motivo, requiere_seguimiento)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      fecha = COALESCE(VALUES(fecha), fecha),
      duracion = COALESCE(VALUES(duracion), duracion),
      costo = COALESCE(VALUES(costo), costo),
      transcripcion = COALESCE(VALUES(transcripcion), transcripcion),
      resumen = COALESCE(VALUES(resumen), resumen),
      razon_finalizacion = COALESCE(VALUES(razon_finalizacion), razon_finalizacion),
      numero_telefono = COALESCE(VALUES(numero_telefono), numero_telefono),
      url_grabacion = COALESCE(VALUES(url_grabacion), url_grabacion),
      nombre_capturado = COALESCE(VALUES(nombre_capturado), nombre_capturado),
      motivo = COALESCE(VALUES(motivo), motivo),
      requiere_seguimiento = COALESCE(VALUES(requiere_seguimiento), requiere_seguimiento)
  `

  const result = await query(sql, [
    call_id,
    fecha,
    duracion,
    costo,
    transcripcion,
    resumen,
    razon_finalizacion,
    numero_telefono,
    url_grabacion,
    nombre_capturado ?? null,
    motivo ?? null,
    requiere_seguimiento ?? null
  ])

  return { call_id, insertada: result.affectedRows === 1 }
}

export async function obtenerLlamadaPorId(callId) {
  const filas = await query('SELECT * FROM llamadas WHERE call_id = ?', [callId])
  return filas[0] ?? null
}

export async function actualizarResumen(callId, resumen) {
  const result = await query('UPDATE llamadas SET resumen = ? WHERE call_id = ?', [resumen, callId])
  return result.affectedRows > 0
}

export async function guardarLlamadas(lista) {
  let insertadas = 0
  let actualizadas = 0
  const errores = []

  for (const llamada of lista) {
    try {
      const resultado = await guardarLlamada(llamada)
      if (resultado.insertada) {
        insertadas++
      } else {
        actualizadas++
      }
    } catch (error) {
      errores.push({ call_id: llamada?.call_id ?? null, error: error.message })
    }
  }

  return { total: lista.length, insertadas, actualizadas, errores }
}

function enteroPositivo(valor, porDefecto) {
  const entero = Math.trunc(Number(valor))
  return Number.isFinite(entero) && entero >= 1 ? entero : porDefecto
}

export async function asignarLlamada(callId, login) {
  const result = await query('UPDATE llamadas SET usuario_asignado = ? WHERE call_id = ?', [login ?? null, callId])
  return result.affectedRows > 0
}

// 'sin-asignar' es un valor especial del filtro: usuario_asignado IS NULL no se puede expresar
// con la igualdad normal porque en SQL nada es igual a NULL
function condicionAsignado(asignadoA) {
  if (asignadoA === undefined || asignadoA === null || asignadoA === '') {
    return { condicion: '', params: [] }
  }

  if (asignadoA === 'sin-asignar') {
    return { condicion: 'WHERE usuario_asignado IS NULL', params: [] }
  }

  return { condicion: 'WHERE usuario_asignado = ?', params: [asignadoA] }
}

export async function listarLlamadas({ page = 1, limit = 20, asignadoA } = {}) {
  const paginaSanitizada = enteroPositivo(page, 1)
  const limiteSanitizado = Math.min(100, enteroPositivo(limit, 20))
  const offset = (paginaSanitizada - 1) * limiteSanitizado
  const { condicion, params } = condicionAsignado(asignadoA)

  // mysql2 no admite placeholders en LIMIT/OFFSET con prepared statements; van interpolados como enteros ya validados
  const sql = `
    SELECT id, call_id, fecha, duracion, costo, resumen, razon_finalizacion, numero_telefono, url_grabacion,
           usuario_asignado, nombre_capturado, motivo, requiere_seguimiento, created_at
    FROM llamadas
    ${condicion}
    ORDER BY fecha DESC, id DESC
    LIMIT ${limiteSanitizado} OFFSET ${offset}
  `

  const data = await query(sql, params)
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM llamadas ${condicion}`, params)

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
