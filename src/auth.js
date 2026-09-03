import { timingSafeEqual } from 'node:crypto'

// Railway define RAILWAY_ENVIRONMENT en todo servicio desplegado; en local no existe.
export const enProduccion = Boolean(process.env.RAILWAY_ENVIRONMENT)

// timingSafeEqual exige buffers de igual longitud; si difieren, el secreto es invalido directamente
export function comparaSecreto(recibido, esperado) {
  const bufA = Buffer.from(String(recibido ?? ''))
  const bufB = Buffer.from(String(esperado ?? ''))

  if (bufA.length !== bufB.length) return false

  return timingSafeEqual(bufA, bufB)
}

// Guard para los endpoints protegidos con ADMIN_API_KEY. Devuelve true si ya respondio con error.
export function rechazaSinAdminKey(request, reply) {
  const adminKey = process.env.ADMIN_API_KEY

  if (!adminKey) {
    reply.code(503).send({ error: 'ADMIN_API_KEY no configurado' })
    return true
  }

  if (!comparaSecreto(request.headers['x-admin-key'], adminKey)) {
    reply.code(401).send({ error: 'No autorizado' })
    return true
  }

  return false
}
