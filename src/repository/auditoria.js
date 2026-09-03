import { query } from '../db.js'

function normalizarDetalle(detalle) {
  if (detalle === null || detalle === undefined) return null
  if (typeof detalle === 'object') return JSON.stringify(detalle)
  return detalle
}

export async function registrarAuditoria({ usuario, accion, detalle }) {
  const sql = 'INSERT INTO auditoria (usuario, accion, detalle) VALUES (?, ?, ?)'
  const result = await query(sql, [usuario, accion, normalizarDetalle(detalle)])

  return { id: result.insertId }
}

function enteroPositivo(valor, porDefecto) {
  const entero = Math.trunc(Number(valor))
  return Number.isFinite(entero) && entero >= 1 ? entero : porDefecto
}

export async function listarAuditoria({ page = 1, limit = 50, accion } = {}) {
  const paginaSanitizada = enteroPositivo(page, 1)
  const limiteSanitizado = Math.min(200, enteroPositivo(limit, 50))
  const offset = (paginaSanitizada - 1) * limiteSanitizado

  const condicion = accion ? 'WHERE accion = ?' : ''
  const params = accion ? [accion] : []

  // mysql2 no admite placeholders en LIMIT/OFFSET con prepared statements; van interpolados como enteros ya validados
  const sql = `
    SELECT id, usuario, accion, detalle, fecha
    FROM auditoria
    ${condicion}
    ORDER BY fecha DESC, id DESC
    LIMIT ${limiteSanitizado} OFFSET ${offset}
  `

  const data = await query(sql, params)
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM auditoria ${condicion}`, params)

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
