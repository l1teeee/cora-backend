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
    url_grabacion
  } = llamada

  // COALESCE(VALUES(col), col): el webhook con el analysis llega despues y trae el resto vacio; no debe pisar lo ya guardado
  const sql = `
    INSERT INTO llamadas
      (call_id, fecha, duracion, costo, transcripcion, resumen, razon_finalizacion, numero_telefono, url_grabacion)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      fecha = COALESCE(VALUES(fecha), fecha),
      duracion = COALESCE(VALUES(duracion), duracion),
      costo = COALESCE(VALUES(costo), costo),
      transcripcion = COALESCE(VALUES(transcripcion), transcripcion),
      resumen = COALESCE(VALUES(resumen), resumen),
      razon_finalizacion = COALESCE(VALUES(razon_finalizacion), razon_finalizacion),
      numero_telefono = COALESCE(VALUES(numero_telefono), numero_telefono),
      url_grabacion = COALESCE(VALUES(url_grabacion), url_grabacion)
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
    url_grabacion
  ])

  return { call_id, insertada: result.affectedRows === 1 }
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

export async function listarLlamadas({ page = 1, limit = 20 } = {}) {
  const paginaSanitizada = enteroPositivo(page, 1)
  const limiteSanitizado = Math.min(100, enteroPositivo(limit, 20))
  const offset = (paginaSanitizada - 1) * limiteSanitizado

  // mysql2 no admite placeholders en LIMIT/OFFSET con prepared statements; van interpolados como enteros ya validados
  const sql = `
    SELECT id, call_id, fecha, duracion, costo, resumen, razon_finalizacion, numero_telefono, url_grabacion, usuario_asignado, created_at
    FROM llamadas
    ORDER BY fecha DESC, id DESC
    LIMIT ${limiteSanitizado} OFFSET ${offset}
  `

  const data = await query(sql)
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM llamadas')

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
