import { rechazaSinAdminKey } from '../auth.js'
import { listarLlamadas, obtenerLlamadaPorId } from '../repository/llamadas.js'

const schema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  }
}

export default async function (fastify, opts) {
  fastify.get('/llamadas', { schema }, async (request, reply) => {
    // El listado devuelve telefonos, resumenes y grabaciones de estudiantes: no puede ser publico
    if (rechazaSinAdminKey(request, reply)) return reply

    const { page, limit } = request.query

    try {
      return await listarLlamadas({ page, limit })
    } catch (error) {
      request.log.error(error, 'Error consultando llamadas')
      return reply.code(500).send({ error: 'Error consultando llamadas' })
    }
  })

  // El listado omite transcripcion a proposito (textos enormes); aqui si va, es una sola fila
  fastify.get('/llamadas/:callId', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const llamada = await obtenerLlamadaPorId(request.params.callId)

      if (!llamada) {
        return reply.code(404).send({ error: 'Llamada no encontrada' })
      }

      return llamada
    } catch (error) {
      request.log.error(error, 'Error consultando la llamada')
      return reply.code(500).send({ error: 'Error consultando la llamada' })
    }
  })
}
