import { obtenerTodasLasLlamadas } from '../vapi/client.js'
import { normalizarDesdeApi } from '../vapi/normalize.js'
import { guardarLlamadas } from '../repository/llamadas.js'

const schema = {
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      maxPaginas: { type: 'integer', minimum: 1, default: 20 }
    }
  }
}

async function sincronizar(request, reply) {
  const adminKey = process.env.ADMIN_API_KEY

  if (!adminKey) {
    return reply.code(503).send({ error: 'ADMIN_API_KEY no configurado' })
  }

  if (request.headers['x-admin-key'] !== adminKey) {
    return reply.code(401).send({ error: 'No autorizado' })
  }

  const { limit, maxPaginas } = request.query

  try {
    const calls = await obtenerTodasLasLlamadas({ limit, maxPaginas })
    const llamadas = calls.map(normalizarDesdeApi).filter((l) => l.call_id)
    const resultado = await guardarLlamadas(llamadas)

    return reply.code(200).send({ ok: true, recibidas: calls.length, ...resultado })
  } catch (error) {
    request.log.error(error, 'Error sincronizando llamadas desde Vapi')

    // Falta de configuracion: lo arregla quien llama. El resto (red, Vapi caido, MySQL) es del servidor.
    if (error.message.includes('VAPI_API_KEY')) {
      return reply.code(400).send({ error: error.message })
    }

    return reply.code(500).send({ error: 'Error sincronizando desde Vapi' })
  }
}

export default async function (fastify, opts) {
  fastify.route({ method: ['GET', 'POST'], url: '/sync/vapi', schema, handler: sincronizar })
}
